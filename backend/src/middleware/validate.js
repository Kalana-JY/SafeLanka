export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', issues: result.error.issues });
    }
    req.body = result.data;
    next();
  };
}
