// Every tunable constant of the AI-likelihood detector. Values were tuned with `npm run calibrate`
// against test/fixtures; see docs/DECISIONS.md for the numbers they produced.
export const DETECTOR = {
  /** Perplexity at which a sentence is a coin flip: pplScore = sigmoid(slope * (ln(mid) - ln(ppl))). */
  pplMidpoint: 85,
  pplSlope: 2.5,

  /** Each stock phrase in a sentence adds this much to its phraseScore (capped at 1). */
  phraseStep: 0.5,
  /** Sentences on each side that count as the "window" for repeated openers. */
  openerRadius: 2,

  /** sentenceScore = wPpl * pplScore + wPhrase * phraseScore + wOpener * openerScore */
  wPpl: 0.7,
  wPhrase: 0.2,
  wOpener: 0.1,

  /** Neighbour smoothing: prev, current, next. */
  smooth: [0.25, 0.5, 0.25] as const,

  /** A sentence is flagged at or above this (adjusted by burstiness). */
  threshold: 0.6,
  thresholdShift: 0.05,
  burstinessLow: 0.5,
  burstinessHigh: 0.75,
  /** Sentences within this much below the threshold are shown as "uncertain". */
  uncertainBand: 0.1,

  /** Burstiness = mean of (std of ln perplexity / stdRef) and (CV of sentence length / cvRef), each capped at 1. */
  burstStdRef: 0.9,
  burstCvRef: 0.6,

  /** Headline label boundaries, in percent of words flagged. */
  labelHuman: 20,
  labelAi: 60,

  mattrWindow: 50,
} as const;

export type DetectorConfig = { [K in keyof typeof DETECTOR]: (typeof DETECTOR)[K] extends number ? number : (typeof DETECTOR)[K] };
