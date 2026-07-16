const WINDOW_MS = 60_000;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
}

const RULES: Record<string, RateLimitRule> = {
  "purchase-pack-v1": { maxRequests: 20, windowMs: 60_000 },
  "start-battle": { maxRequests: 30, windowMs: 60_000 },
  "complete-battle": { maxRequests: 30, windowMs: 60_000 },
  "complete-tower-floor": { maxRequests: 20, windowMs: 60_000 },
  "pvp-start-match": { maxRequests: 20, windowMs: 60_000 },
  "pvp-complete-match": { maxRequests: 20, windowMs: 60_000 },
};

const buckets = new Map<string, RateLimitBucket>();

function bucketKey(userId: string, ruleKey: string): string {
  return `${userId}:${ruleKey}`;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkRateLimit(userId: string, ruleKey: string): RateLimitResult {
  const rule = RULES[ruleKey];
  if (!rule) return { allowed: true, retryAfterMs: 0 };

  const now = Date.now();
  const key = bucketKey(userId, ruleKey);
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  bucket.count += 1;
  if (bucket.count > rule.maxRequests) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}, 120_000).unref();
