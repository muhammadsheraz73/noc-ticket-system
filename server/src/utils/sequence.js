import Counter from '../models/Counter.js';

/**
 * Atomically reserve the next value of a named sequence.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is a single atomic document
 * operation, so concurrent ticket creation can never hand out the same TID
 * twice — the uniqueness requirement is enforced server-side, never by the
 * client.
 */
export async function nextSequence(key, startAt = 1) {
  const existing = await Counter.findById(key).lean();

  if (!existing) {
    // Seed the counter so the first issued value is exactly `startAt`.
    await Counter.updateOne(
      { _id: key },
      { $setOnInsert: { seq: startAt - 1 } },
      { upsert: true },
    );
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return counter.seq;
}

/** Raise a sequence so the next issued value is at least `value`. */
export async function ensureSequenceAtLeast(key, value) {
  await Counter.updateOne(
    { _id: key },
    { $max: { seq: value } },
    { upsert: true },
  );
}

export default nextSequence;
