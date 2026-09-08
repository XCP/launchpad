import { configureWalletSdk } from "@xcp/wallet-sdk";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

// Wallet quotes, spend checks, composition and broadcasts need the live node.
// Routine page reads use the separate indexed/read API. Keep the SDK's
// existing direct-first transport and its browser relay fallback for refusals.
configureWalletSdk({ counterpartyApiBase: COUNTERPARTY_API_BASE });
