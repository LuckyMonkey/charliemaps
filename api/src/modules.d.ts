declare module "pg" {
  export type QueryResult<TRow = unknown> = {
    rows: TRow[];
    rowCount: number | null;
  };

  export class PoolClient {
    query<TRow = unknown>(text: string, params?: unknown[]): Promise<QueryResult<TRow>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: { connectionString?: string });
    query<TRow = unknown>(text: string, params?: unknown[]): Promise<QueryResult<TRow>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}

declare module "uuid" {
  export function validate(value: string): boolean;
}
