# Demand Planning Engine

## Holiday and Weekend Adjustments
The Holt-Winters exponential smoothing model incorporates weekend and public holiday multipliers:
- Friday/Saturday/Sunday dinner surge factor: 1.35x
- Weekday lunch base multiplier: 1.0x


## Low-Sample Validation
When historical volume is under 14 days, the model falls back to weighted rolling averages to prevent variance explosion.

