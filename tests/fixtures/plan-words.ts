/**
 * Words only a paid plan would put on screen: a price, a trial, a Pro tier, a
 * subscription or checkout, a licence key, the payment provider, or a limit
 * to run into. Vocette is free for everyone, so no page may show any of them.
 */
export const PLAN_WORDS =
  /\b(?:US|A|C|NZ)\$\s?\d|[€£]\s?\d|\b(?:a|per) (?:month|year)\b|\btrial\b|\bPro\b|\bSubscribe\b|\bsubscription\b|\bcheckout\b|licen[cs]e key|polar|free words|word limit|used up|\bupgrade\b/iu
