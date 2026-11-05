//! GGM window keys. One secret seed at the root of a binary hash tree over time slots; a child is
//! `H("keyhole/ggm/v1" || bit || parent)`. Holding a node means being able to compute exactly the leaves below it.
//! So a window of slots is sold as its *cover*: the few nodes whose subtrees are exactly that window.
//!
//! Each node also has a public commitment `c = H("keyhole/c/v1" || node)`. The Merkle tree over those commitments mirrors the
//! GGM tree: `M(leaf) = H("keyhole/m/v1" || c)`, `M(inner) = H("keyhole/m/v1" || c || M(left) || M(right))`. Its
//! root is posted before any sale, which fixes every node of the tree at once.
use crate::Hash;

pub type Node = [u8; 32];

/// A node's place in the tree: `level` 0 is the root, `level == depth` is a leaf, `index < 2^level`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NodeId {
    pub level: u8,
    pub index: u32,
}

impl NodeId {
    /// The slots below this node, inclusive.
    pub fn slots(&self, depth: u8) -> (u32, u32) {
        let shift = (depth - self.level) as u32;
        let first = self.index << shift;
        (first, first + ((1u64 << shift) - 1) as u32)
    }
}

pub fn child<H: Hash>(node: &Node, bit: u8) -> Node {
    H::hash_parts(&[b"keyhole/ggm/v1", &[bit], node])
}

pub fn commit<H: Hash>(node: &Node) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/c/v1", node])
}

/// The node `to` computed from its ancestor (or itself) `from`. `None` if `to` isn't below `from`.
pub fn descend<H: Hash>(value: &Node, from: NodeId, to: NodeId) -> Option<Node> {
    if to.level < from.level {
        return None;
    }
    let shift = to.level - from.level;
    if shift >= 32 || (to.index >> shift) != from.index {
        return None;
    }
    let mut v = *value;
    for i in (0..shift).rev() {
        v = child::<H>(&v, ((to.index >> i) & 1) as u8);
    }
    Some(v)
}

/// The leaf for `slot`, computed from a cover node, or `None` if that slot is outside the node's subtree.
pub fn leaf_from<H: Hash>(value: &Node, from: NodeId, depth: u8, slot: u32) -> Option<Node> {
    descend::<H>(value, from, NodeId { level: depth, index: slot })
}

/// The canonical cover of `[first, last]`: the fewest nodes whose subtrees are exactly that range, left to right.
/// At most `2 * depth` nodes.
pub fn cover(first: u32, last: u32, depth: u8) -> Vec<NodeId> {
    let mut out = Vec::new();
    if first <= last && ((last as u64) >> depth) == 0 {
        cover_rec(NodeId { level: 0, index: 0 }, first, last, depth, &mut out);
    }
    out
}

fn cover_rec(n: NodeId, first: u32, last: u32, depth: u8, out: &mut Vec<NodeId>) {
    let (a, b) = n.slots(depth);
    if b < first || a > last {
        return;
    }
    if first <= a && b <= last {
        out.push(n);
        return;
    }
    cover_rec(NodeId { level: n.level + 1, index: n.index * 2 }, first, last, depth, out);
    cover_rec(NodeId { level: n.level + 1, index: n.index * 2 + 1 }, first, last, depth, out);
}

pub fn m_leaf<H: Hash>(c: &[u8; 32]) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/m/v1", c])
}

pub fn m_inner<H: Hash>(c: &[u8; 32], l: &[u8; 32], r: &[u8; 32]) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/m/v1", c, l, r])
}

/// Check `commits` (one per node of the cover of `[first, last]`, in order) against the Merkle `root`, reading the rest of what's
/// needed from `proof` in the order a depth-first walk needs it:
///
/// - a cover node that is a leaf needs nothing; an inner cover node needs `M(left), M(right)`;
/// - a node outside the window needs its `M`;
/// - an ancestor of the window needs its `c`.
///
/// All of `commits` and all of `proof` must be used. About `3 * depth` hashes of proof at most.
pub fn verify_cover<H: Hash>(root: &[u8; 32], depth: u8, first: u32, last: u32, commits: &[[u8; 32]], proof: &[[u8; 32]]) -> bool {
    let nodes = cover(first, last, depth);
    if nodes.is_empty() || nodes.len() != commits.len() {
        return false;
    }
    let mut w = Walk { depth, first, last, commits, proof, c_at: 0, p_at: 0, ok: true };
    let got = w.rec::<H>(NodeId { level: 0, index: 0 });
    w.ok && w.c_at == commits.len() && w.p_at == proof.len() && &got == root
}

struct Walk<'a> {
    depth: u8,
    first: u32,
    last: u32,
    commits: &'a [[u8; 32]],
    proof: &'a [[u8; 32]],
    c_at: usize,
    p_at: usize,
    ok: bool,
}

impl Walk<'_> {
    fn next_proof(&mut self) -> [u8; 32] {
        match self.proof.get(self.p_at) {
            Some(h) => {
                self.p_at += 1;
                *h
            }
            None => {
                self.ok = false;
                [0u8; 32]
            }
        }
    }

    fn rec<H: Hash>(&mut self, n: NodeId) -> [u8; 32] {
        let (a, b) = n.slots(self.depth);
        if b < self.first || a > self.last {
            return self.next_proof();
        }
        if self.first <= a && b <= self.last {
            let c = match self.commits.get(self.c_at) {
                Some(c) => *c,
                None => {
                    self.ok = false;
                    return [0u8; 32];
                }
            };
            self.c_at += 1;
            if n.level == self.depth {
                return m_leaf::<H>(&c);
            }
            let l = self.next_proof();
            let r = self.next_proof();
            return m_inner::<H>(&c, &l, &r);
        }
        let c = self.next_proof();
        let l = self.rec::<H>(NodeId { level: n.level + 1, index: n.index * 2 });
        let r = self.rec::<H>(NodeId { level: n.level + 1, index: n.index * 2 + 1 });
        m_inner::<H>(&c, &l, &r)
    }
}

/// The whole tree, for traders and tests. Memory is `2^(depth+1) * 64` bytes, so not for the contract.
#[cfg(any(feature = "sha2", test))]
pub struct Tree {
    pub depth: u8,
    /// `nodes[level][index]`.
    pub nodes: Vec<Vec<Node>>,
    /// `merkle[level][index]`.
    pub merkle: Vec<Vec<[u8; 32]>>,
}

#[cfg(any(feature = "sha2", test))]
impl Tree {
    pub fn build<H: Hash>(seed: &Node, depth: u8) -> Self {
        let mut nodes = vec![vec![*seed]];
        for l in 0..depth as usize {
            let below: Vec<Node> = nodes[l].iter().flat_map(|v| [child::<H>(v, 0), child::<H>(v, 1)]).collect();
            nodes.push(below);
        }
        let mut merkle: Vec<Vec<[u8; 32]>> = vec![Vec::new(); depth as usize + 1];
        merkle[depth as usize] = nodes[depth as usize].iter().map(|v| m_leaf::<H>(&commit::<H>(v))).collect();
        for l in (0..depth as usize).rev() {
            merkle[l] = nodes[l]
                .iter()
                .enumerate()
                .map(|(i, v)| m_inner::<H>(&commit::<H>(v), &merkle[l + 1][i * 2], &merkle[l + 1][i * 2 + 1]))
                .collect();
        }
        Tree { depth, nodes, merkle }
    }

    pub fn root(&self) -> [u8; 32] {
        self.merkle[0][0]
    }

    /// The commitments and the proof stream `verify_cover` wants for `[first, last]`.
    pub fn prove<H: Hash>(&self, first: u32, last: u32) -> (Vec<[u8; 32]>, Vec<[u8; 32]>) {
        let mut commits = Vec::new();
        let mut proof = Vec::new();
        self.prove_rec::<H>(NodeId { level: 0, index: 0 }, first, last, &mut commits, &mut proof);
        (commits, proof)
    }

    fn prove_rec<H: Hash>(&self, n: NodeId, first: u32, last: u32, commits: &mut Vec<[u8; 32]>, proof: &mut Vec<[u8; 32]>) {
        let (a, b) = n.slots(self.depth);
        let (l, i) = (n.level as usize, n.index as usize);
        if b < first || a > last {
            proof.push(self.merkle[l][i]);
            return;
        }
        if first <= a && b <= last {
            commits.push(commit::<H>(&self.nodes[l][i]));
            if n.level != self.depth {
                proof.push(self.merkle[l + 1][i * 2]);
                proof.push(self.merkle[l + 1][i * 2 + 1]);
            }
            return;
        }
        proof.push(commit::<H>(&self.nodes[l][i]));
        self.prove_rec::<H>(NodeId { level: n.level + 1, index: n.index * 2 }, first, last, commits, proof);
        self.prove_rec::<H>(NodeId { level: n.level + 1, index: n.index * 2 + 1 }, first, last, commits, proof);
    }
}
