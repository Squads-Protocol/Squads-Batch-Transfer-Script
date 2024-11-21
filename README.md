
# Squads Batch Transfer Script

A TypeScript-powered tool for executing batch SPL token transfers on the Solana blockchain using the **Squads Multisig SDK**. This script helps simplify complex batch transactions for multisig wallets, leveraging the power of the Squads SDK to handle multisig proposals and batching, while mitigating issues such as Solana blockhash expiry.

---

## Features

- **Batch Transfers**: Automates SPL token transfers in batches, supporting efficient execution.
- **Multisig Integration**: Uses Squads Multisig SDK for secure and transparent multisig transactions.
- **Address Lookup Tables (ALTs)**: Supports ALTs for handling large sets of instructions efficiently.
- **Customizable Parameters**: Configure multisig address, vault index, RPC URL, and CSV file paths for flexibility.
- **Optimized for Solana**: Mitigates blockhash expiry challenges through proper batching and retries.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- Yarn or npm for dependency management
- A Solana wallet keypair in JSON format
- A valid RPC endpoint (e.g., Squads-provided endpoint or Solana mainnet)
- **Proposer Permission**: The wallet keypair must belong to a member of the target multisig (Squad) with the "Proposer" permission. Without this, the script will not be able to create transactions.

---

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/squads-software/squads-batch-transfer.git
   cd squads-batch-transfer
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```
   or
   ```bash
   npm install
   ```

3. Make sure the TypeScript environment is set up:
   ```bash
   yarn add typescript ts-node @types/node --dev
   ```

---

## Usage

### Command-Line Arguments

The script accepts the following CLI arguments:

| Argument             | Description                                   | Required |
|----------------------|-----------------------------------------------|----------|
| `--msAddress`        | Multisig wallet address                       | ✅       |
| `--walletKeypairPath`| Path to the Solana wallet keypair JSON file   | ✅       |
| `--rpcUrl`           | RPC endpoint for the Solana blockchain        | ❌ (default: `https://api.mainnet-beta.solana.com`) |
| `--csvFilePath`      | Path to the CSV file containing transfer data | ✅       |
| `--vaultIndex`       | Vault Index for batching transactions         | ❌ (default: `0`) |

---

### CSV File Format

The CSV file should be structured as follows:

| Column        | Description                           |
|---------------|---------------------------------------|
| `token_address` | SPL token mint address              |
| `receiver`      | Recipient wallet address            |
| `amount`        | Number of tokens to transfer        |

Example (`transfers.csv`):
```csv
token_address,receiver,amount
So11111111111111111111111111111111111111112,FoobarAddress1,100
So11111111111111111111111111111111111111112,FoobarAddress2,50
```

---

### Running the Script

To execute the script, run:
```bash
yarn start -- --msAddress <MULTISIG_ADDRESS>   --walletKeypairPath /path/to/keypair.json   --rpcUrl https://your.rpc.endpoint   --csvFilePath /path/to/transfers.csv   --vaultIndex <VAULT_INDEX>
```

Example:
```bash
yarn start -- --msAddress 2ruoY9FridQjcxxmgzQWnTx6U9sBxoMkB3EU1UBg4PtK   --walletKeypairPath ~/.config/solana/id.json   --csvFilePath ./transfers.csv   --vaultIndex 0
```

---

### Output

- Parses the CSV file to generate transfer instructions.
- Validates token accounts and handles token account creation if necessary.
- Batches transactions and submits them to the blockchain using Squads' Multisig SDK.
- Provides transaction signatures and confirmation statuses.

---

## Development Workflow

### Compile TypeScript
To compile the TypeScript code:
```bash
yarn build
```

### Run TypeScript Directly
To execute the TypeScript code without compiling:
```bash
yarn start
```

---

## Project Structure

```
squads-batch-transfer/
├── main.ts           # Main script
├── tsconfig.json     # TypeScript configuration
├── package.json      # Project dependencies and scripts
├── yarn.lock         # Dependency lock file
├── README.md         # Documentation
├── node_modules/     # Installed dependencies
```

---

## Dependencies

- [@solana/web3.js](https://github.com/solana-labs/solana-web3.js)
- [@solana/spl-token](https://github.com/solana-labs/solana-program-library)
- [@sqds/multisig](https://github.com/squads-software/multisig)
- [csv-parser](https://github.com/mafintosh/csv-parser)
- [yargs](https://github.com/yargs/yargs)

---

## About Squads

**Squads** is the most advanced multisig platform for Solana, enabling on-chain collaboration and secure, flexible management of funds and programs. Visit [Squads.so](https://squads.so) for more information.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Disclaimer

This script is provided "as-is" and is intended for advanced users. Please use caution when handling private keys and interacting with on-chain resources.
