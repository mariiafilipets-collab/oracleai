/**
 * Lightweight request validation middleware.
 * Usage: router.post("/path", validate(schema), handler)
 *
 * Schema is an object with optional `body`, `query`, `params` keys.
 * Each key maps to a validation function that returns { valid: boolean, errors?: string[] }.
 */
export function validate(schema) {
  return (req, res, next) => {
    const allErrors = [];

    for (const [source, validator] of Object.entries(schema)) {
      const data = req[source];
      const result = validator(data || {});
      if (!result.valid && result.errors) {
        allErrors.push(...result.errors.map((e) => `${source}: ${e}`));
      }
    }

    if (allErrors.length > 0) {
      return res.status(400).json({ success: false, errors: allErrors });
    }
    next();
  };
}

// Common validators
export function isAddress(value) {
  return /^0x[a-f0-9]{40}$/i.test(String(value || ""));
}

export function isPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

export function isNonEmptyString(value, maxLen = 500) {
  const s = String(value || "").trim();
  return s.length > 0 && s.length <= maxLen;
}
