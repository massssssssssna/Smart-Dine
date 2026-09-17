# SmartDine AI - Historical Export Service Specification

## Overview
The Historical Export Service provides asynchronous and on-demand report generation for all four SmartDine operational portals:
- **Manager**: Complete operations history (financials, table, staff attribution, line items).
- **Cashier**: Billing and settlement records (receipt numbers, payments, taxes, discounts).
- **Waiter**: Personal served and cancelled dining orders (`created_by == actor.id`).
- **Kitchen**: Station dispatch tickets, preparation times, and dish quantities (**strictly financial-masked**).

## Architectural Standards
1. **Timezone Inclusivity**:
   All user date queries are interpreted in `Asia/Karachi` standard time (`PKT`, `UTC+05:00`).
   Queries are mapped to UTC half-open intervals:
   $$\text{start\_utc} = \text{datetime}(\text{start\_date}, 00:00:00)_{\text{Karachi}} \to \text{UTC}$$
   $$\text{end\_utc} = \text{datetime}(\text{end\_date} + 1\text{ day}, 00:00:00)_{\text{Karachi}} \to \text{UTC}$$

2. **Security & Formula Injection Defense**:
   All textual cells in Excel `.xlsx` exports are sanitized against CSV/Excel Injection (CWE-1236).
   Leading dangerous prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are escaped with a leading single quote (`'`).

3. **PDF Generation (Landscape A4)**:
   - High-density landscape layout with ReportLab Platypus.
   - Dynamic `NumberedCanvas` performing a two-pass calculation for accurate `"Page X of Y"` footers.
   - Flowable Paragraph table cells preventing text overflow or truncation.
