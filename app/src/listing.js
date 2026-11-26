// Reading every value under a key prefix, page by page, up to a cap.
//
// Forge storage hands out at most 100 values a page. A caller that counts what it read, like
// the pause check over verdicts, must not mistake a list cut at the cap for the whole, so the
// returned array says whether it was cut.

export async function listAll(query, prefix, max) {
  const out = [];
  const q = query(prefix);
  let cursor;
  do {
    const page = await q.page(cursor);
    out.push(...(page?.results ?? []).map((r) => r.value));
    cursor = page?.nextCursor;
  } while (cursor && out.length < max);
  const truncated = out.length > max || (out.length >= max && Boolean(cursor));
  return Object.assign(out.slice(0, max), { truncated });
}
