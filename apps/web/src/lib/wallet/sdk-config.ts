import { configureWalletSdk } from "@xcp/wallet-sdk";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

// Imported for its effect by the modules that read the node: the wallet context and the API client.
configureWalletSdk({ counterpartyApiBase: COUNTERPARTY_API_BASE });
