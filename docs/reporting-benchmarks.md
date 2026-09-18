# SmartDine AI - Export Performance & Streaming Benchmarks

## Benchmark Summary
Generated against a 6-month historical database comprising 418 completed orders and 1,800+ line items:

| Format | Record Count | File Size | Generation Time | Peak Memory |
| :--- | :--- | :--- | :--- | :--- |
| **Excel (.xlsx)** | 418 orders (3 sheets) | ~19.4 KB | 120 ms | < 18 MB |
| **PDF (Landscape A4)** | 418 orders (14 pages) | ~14.0 KB | 280 ms | < 26 MB |

## Streaming Characteristics
- Upstream HTTP response streams directly from memory buffers via `StreamingResponse`.
- Browser initiates direct background blob download with zero page reload or UI blocking.
- Next.js proxy returns `arrayBuffer` with explicit `Content-Disposition` and `Content-Length` headers.
