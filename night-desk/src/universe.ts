// The tradeable universe: liquid US large-caps and the S&P sector ETFs. Equities only (the market the prompt is about:
// earnings, Fed, CPI, sector flows). No options, no crypto. Kept small and liquid so paper fills are realistic.
export const SECTOR_ETFS = ["SPY", "QQQ", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE", "XLC"];

export const LARGE_CAPS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "NFLX",
  "JPM", "V", "MA", "UNH", "XOM", "CVX", "LLY", "COST", "WMT", "HD",
  "PG", "KO", "PEP", "DIS", "BA", "CAT", "GE", "INTC", "MU", "CRM",
];

export const UNIVERSE = [...SECTOR_ETFS, ...LARGE_CAPS];
