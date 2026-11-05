//! The attested PnL job. It answers one question for a trader with no buyers yet: what does this journal's epoch really add up to?
//!
//! It runs the same `keyhole_core` code as the contract's fraud proof, so its answer is the contract's answer, to the unit.
//! - Under OutLayer, a TDX worker runs this wasm pinned by sha256: the key material is an OutLayer secret, and the output goes to the contract's callback.
//! - Locally, under wasmtime, a registered runner runs the same wasm and submits the output. No enclave: the contract labels that
//!   `SimulatedLocal`, and it can't say otherwise.
//!
//! Input on stdin:
//!   {"contract": "...", "trader": "...", "epoch": 3, "rpc": "http://..."}      read everything else from the chain over HTTP (wasi:http), or
//!   {"trader": "...", "epoch": 3, "data": {book_usd_e6, feeds, epoch_end_ms, head, entries, rounds}}   everything given (tests, and hosts without HTTP)
//! Key material, never in the input: KEYHOLE_NODES='[{"level":..,"index":..,"value":"<hex>"}]' from the environment, which is OutLayer's secret mechanism.
//! Output on stdout: {"trader","epoch","pnl_e6","head","applied","void","job_sha256"}. Anything else (a key that opens nothing, a missing round) exits 1.
use keyhole_core::entry;
use keyhole_core::ggm::{self, NodeId};
use keyhole_core::pnl::{pnl_e6, Book, MAX_FEEDS};
use keyhole_core::Sha2;
use serde_json::{json, Value};
use std::io::Read;

type Res<T> = Result<T, String>;
const DEPTH: u8 = 16;

fn hex32(v: &Value, what: &str) -> Res<[u8; 32]> {
    let s = v.as_str().ok_or(format!("{what}: not a string"))?;
    let b = hex::decode(s).map_err(|e| format!("{what}: {e}"))?;
    b.try_into().map_err(|_| format!("{what}: not 32 bytes"))
}

fn num(v: &Value, what: &str) -> Res<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).ok_or(format!("{what}: not a number"))
}

#[cfg(target_os = "wasi")]
fn rpc_view(rpc: &str, contract: &str, method: &str, args: &Value) -> Res<Value> {
    fn b64(data: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::new();
        for c in data.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            s.push(T[(n >> 18) as usize & 63] as char);
            s.push(T[(n >> 12) as usize & 63] as char);
            s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        s
    }
    let q = json!({ "jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method, "args_base64": b64(args.to_string().as_bytes()) } });
    let resp = wasi_http_client::Client::new()
        .post(rpc)
        .header("Content-Type", "application/json")
        .body(q.to_string().as_bytes())
        .send()
        .map_err(|e| format!("rpc: {e:?}"))?;
    let body = resp.body().map_err(|e| format!("rpc body: {e:?}"))?;
    let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let bytes: Vec<u8> = v["result"]["result"].as_array().ok_or(format!("rpc: no result: {v}"))?.iter().map(|x| x.as_u64().unwrap_or(0) as u8).collect();
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "wasi"))]
fn rpc_view(_: &str, _: &str, _: &str, _: &Value) -> Res<Value> {
    Err("HTTP exists only under wasi".into())
}

/// Everything the replay needs, read from the chain. Nothing here is trusted beyond what the tag check and the chain's own state give.
fn from_chain(input: &Value) -> Res<Value> {
    let (rpc, contract, trader) = (input["rpc"].as_str().ok_or("no rpc")?, input["contract"].as_str().ok_or("no contract")?, input["trader"].as_str().ok_or("no trader")?);
    let epoch = num(&input["epoch"], "epoch")?;
    let t = rpc_view(rpc, contract, "get_trader", &json!({ "account": trader }))?;
    let cfg = rpc_view(rpc, contract, "get_config", &json!({}))?;
    let clock = rpc_view(rpc, contract, "clock", &json!({}))?;
    let ep = rpc_view(rpc, contract, "get_epochs", &json!({ "account": trader, "from": epoch, "limit": 1 }))?;
    let feeds = rpc_view(rpc, contract, "get_feeds", &json!({}))?;
    let mut entries = Vec::new();
    if let Some(e) = ep.as_array().and_then(|a| a.first()) {
        let (first, count) = (num(&e["first_seq"], "first_seq")?, num(&e["entries"], "entries")?);
        let mut s = first;
        while s < first + count {
            let got = rpc_view(rpc, contract, "get_entries", &json!({ "account": trader, "from": s.to_string(), "limit": 100 }))?;
            for x in got.as_array().ok_or("entries")? {
                if num(&x["seq"], "seq")? < first + count {
                    entries.push(x.clone());
                }
            }
            s += 100;
        }
    }
    let mut rounds = Vec::new();
    for (f, feed) in feeds.as_array().ok_or("feeds")?.iter().enumerate() {
        let total = num(&feed["rounds"], "rounds")?;
        let mut all: Vec<Value> = Vec::new();
        let mut from = 0;
        while from < total {
            let got = rpc_view(rpc, contract, "get_rounds", &json!({ "feed": f, "from": from, "limit": 1000 }))?;
            all.extend(got.as_array().ok_or("rounds")?.iter().cloned());
            from += 1000;
        }
        rounds.push(all);
    }
    let slot_ms = num(&cfg["slot_secs"], "slot_secs")? * 1000;
    let epoch_end_ms = num(&clock["genesis_ms"], "genesis")? + (epoch + 1) * num(&cfg["epoch_slots"], "epoch_slots")? * slot_ms;
    let head = entries.last().map(|e| e["head"].clone()).unwrap_or(t["head"].clone());
    Ok(json!({ "book_usd_e6": t["book_usd_e6"], "feeds": rounds.len(), "epoch_end_ms": epoch_end_ms, "head": head, "entries": entries, "rounds": rounds }))
}

fn first_at_or_after(rounds: &[(u64, i64)], at: u64) -> Option<i64> {
    let i = rounds.partition_point(|r| r.0 < at);
    rounds.get(i).map(|r| r.1)
}

fn run(input: &Value, nodes_json: &str) -> Res<Value> {
    let data = if input.get("data").is_some() { input["data"].clone() } else { from_chain(input)? };
    let nodes: Vec<(NodeId, [u8; 32])> = serde_json::from_str::<Value>(nodes_json)
        .map_err(|e| format!("KEYHOLE_NODES: {e}"))?
        .as_array()
        .ok_or("KEYHOLE_NODES: not a list")?
        .iter()
        .map(|n| Ok((NodeId { level: num(&n["level"], "level")? as u8, index: num(&n["index"], "index")? as u32 }, hex32(&n["value"], "value")?)))
        .collect::<Res<_>>()?;
    let feeds = num(&data["feeds"], "feeds")? as usize;
    let mut rounds: Vec<Vec<(u64, i64)>> = Vec::new();
    for f in data["rounds"].as_array().ok_or("rounds")? {
        rounds.push(f.as_array().ok_or("rounds")?.iter().map(|r| Ok((num(&r["t_ms"], "t_ms")?, r["answer_e8"].as_i64().ok_or("answer_e8")?))).collect::<Res<_>>()?);
    }
    let book_usd: i128 = data["book_usd_e6"].as_str().and_then(|s| s.parse().ok()).ok_or("book_usd_e6")?;
    let mut book = Book::default();
    for e in data["entries"].as_array().ok_or("entries")? {
        let (seq, slot) = (num(&e["seq"], "seq")?, num(&e["slot"], "slot")? as u32);
        let leaf = nodes.iter().find_map(|(id, v)| ggm::leaf_from::<Sha2>(v, *id, DEPTH, slot)).ok_or(format!("entry {seq}: slot {slot} isn't under the nodes given"))?;
        let key = entry::entry_key::<Sha2>(&leaf, seq);
        let ct = hex::decode(e["ct"].as_str().ok_or("ct")?).map_err(|x| x.to_string())?;
        let tag = hex32(&e["tag"], "tag")?;
        let opened = entry::open::<Sha2>(&key, seq, slot, &ct, &tag).ok_or(format!("entry {seq} doesn't open"))?;
        match opened {
            Some(t) if (t.feed as usize) < feeds => {
                let p = first_at_or_after(&rounds[t.feed as usize], num(&e["at_ms"], "at_ms")?).ok_or(format!("no round after entry {seq} yet"))?;
                book.apply(t.feed as usize, t.qty_e8, p, feeds, book_usd);
            }
            _ => book.void = book.void.saturating_add(1),
        }
    }
    let end = num(&data["epoch_end_ms"], "epoch_end_ms")?;
    let mut marks = [None; MAX_FEEDS];
    for f in 0..MAX_FEEDS {
        if book.positions[f] != 0 {
            marks[f] = Some(first_at_or_after(&rounds[f], end).ok_or(format!("no round after the epoch's end on feed {f} yet"))?);
        }
    }
    let total = book.marked_e16(&marks).ok_or("marks overflowed")?;
    Ok(json!({
        "trader": input["trader"], "epoch": input["epoch"], "pnl_e6": pnl_e6(total).to_string(), "head": data["head"],
        "applied": book.applied, "void": book.void, "job_sha256": std::env::var("KEYHOLE_JOB_SHA256").unwrap_or_default(),
    }))
}

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).expect("stdin");
    let input: Value = serde_json::from_str(&s).expect("input JSON");
    let nodes = std::env::var("KEYHOLE_NODES").unwrap_or_else(|_| "[]".into());
    match run(&input, &nodes) {
        Ok(out) => println!("{out}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
