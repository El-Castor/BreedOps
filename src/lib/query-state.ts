export type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type CollectionState<T> =
  | { status: "data"; data: T }
  | { status: "empty"; data: T }
  | { status: "error"; data: T; message: string };

export function collectionState<T extends unknown[]>(
  result: QueryResult<T>,
  message: string,
): CollectionState<T> {
  if (result.error) {
    console.error("BreedOps query failed", {
      message: result.error.message,
      userMessage: message,
    });
    return { status: "error", data: [] as unknown as T, message };
  }
  const data = result.data ?? ([] as unknown as T);
  return data.length ? { status: "data", data } : { status: "empty", data };
}
