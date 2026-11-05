// The deflated Sharpe ratio (Bailey & Lopez de Prado, 2014): the probability that a track record's true Sharpe beats zero after
// allowing for how many track records it may have been picked from. One account can't prove it isn't the best of ten journals; this
// is how much that possibility should cost it. Everything is computed from the public epoch series.

/** Abramowitz-Stegun 26.2.17 for the standard normal CDF; accurate to about 1e-7. */
export function phi(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Acklam's approximation of the inverse normal CDF. */
export function phiInv(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0, 1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return -phiInv(1 - p);
}

export type Stats = { n: number; mean: number; sd: number; sharpe: number; skew: number; kurt: number };

export function stats(returns: number[]): Stats {
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const m2 = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(n, 1);
  const sd = Math.sqrt(m2);
  if (n === 0 || sd < 1e-12) return { n, mean, sd, sharpe: 0, skew: 0, kurt: 3 };
  const m3 = returns.reduce((a, r) => a + (r - mean) ** 3, 0) / n;
  const m4 = returns.reduce((a, r) => a + (r - mean) ** 4, 0) / n;
  return { n, mean, sd, sharpe: mean / sd, skew: m3 / sd ** 3, kurt: m4 / sd ** 4 };
}

export const MIN_DAYS = 20;
export const MIN_ACTIVE_DAYS = 12;
const EULER = 0.5772156649015329;

/**
 * P(true Sharpe > 0) for a return series assumed to be the best of `trials` independent tries.
 * With `trials = 1` this is the plain probabilistic Sharpe ratio. Null when there's too little data to say anything.
 */
export function deflatedSharpe(returns: number[], trials: number): number | null {
  const s = stats(returns);
  // A handful of active days can't support this number: tomo's 9 trades once read as 86%.
  if (s.n < MIN_DAYS || returns.filter((r) => r !== 0).length < MIN_ACTIVE_DAYS || s.sd < 1e-12) return null;
  // The Sharpe a best-of-N would show by luck alone, with the estimator's own variance.
  const varSr = (1 - s.skew * s.sharpe + ((s.kurt - 1) / 4) * s.sharpe ** 2) / (s.n - 1);
  const benchmark = trials <= 1 ? 0 : Math.sqrt(Math.max(varSr, 0)) * ((1 - EULER) * phiInv(1 - 1 / trials) + EULER * phiInv(1 - 1 / (trials * Math.E)));
  // The formula's denominator falls toward zero for a lumpy, right-skewed series, and would flatter exactly the records it should doubt. Floor it.
  const denom = Math.sqrt(Math.max(1 - s.skew * s.sharpe + ((s.kurt - 1) / 4) * s.sharpe ** 2, 0.5));
  return phi(((s.sharpe - benchmark) * Math.sqrt(s.n - 1)) / denom);
}
