export interface VectorMatch {
  id: string;
  score: number;
}

/**
 * Nearest-neighbour search over card image embeddings for the scanner. Interface only: the
 * scanner ticket (VB-37) adds the implementation.
 */
export interface VectorIndex {
  upsert(vectors: { id: string; values: number[] }[]): Promise<void>;
  query(values: number[], topK: number): Promise<VectorMatch[]>;
}
