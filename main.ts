import * as multisig from "@sqds/multisig";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SignatureStatus,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import csv from "csv-parser";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

(async () => {
  const argv = await yargs(hideBin(process.argv))
    .option("msAddress", {
      type: "string",
      description: "The Multisig address",
      demandOption: true,
    })
    .option("walletKeypairPath", {
      type: "string",
      description: "Path to the wallet keypair JSON file",
      demandOption: true,
    })
    .option("rpcUrl", {
      type: "string",
      description: "RPC URL for the connection",
      default: "https://api.mainnet-beta.solana.com",
    })
    .option("csvFilePath", {
      type: "string",
      description: "Path to the CSV file",
      demandOption: true,
    })
    .option("vaultIndex", {
      type: "number",
      description: "Vault Index to use",
      default: 0,
    })
    .help()
    .alias("help", "h")
    .parse();

  const connection = new Connection(argv.rpcUrl);
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync(argv.walletKeypairPath, "utf-8"))
    )
  );
  const MS_ADDRESS = new PublicKey(argv.msAddress);
  const VAULT_INDEX = argv.vaultIndex;

  const PRIORITY_FEES = 200_000; // LAMPORTS
  const COMPUTE_UNITS = 80_000;
  const MAX_ATTEMPTS = 120;

  interface CsvRow {
    token_address: string;
    receiver: string;
    amount: string;
  }

  const readCsvFile = (filePath: string): Promise<CsvRow[]> => {
    return new Promise((resolve, reject) => {
      const results: CsvRow[] = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", (err) => reject(err));
    });
  };

  const confirmSignatureStatuses = async ({
    signature,
    connection,
    commitment = "confirmed",
    tx,
  }: {
    signature: string;
    connection: Connection;
    commitment?: "processed" | "confirmed" | "finalized";
    tx: VersionedTransaction;
  }) => {
    const commitmentLevels = {
      processed: 0,
      confirmed: 1,
      finalized: 2,
    };

    let confirmationStatus:
      | "processed"
      | "confirmed"
      | "finalized"
      | undefined = undefined;
    let signatureValue: SignatureStatus = {
      err: true,
      confirmations: null,
      slot: 0,
    };
    let attempts = 0;

    while (
      (confirmationStatus === undefined ||
        commitmentLevels[confirmationStatus] < commitmentLevels[commitment]) &&
      attempts < MAX_ATTEMPTS
    ) {
      const signatureStatus = await connection.getSignatureStatuses([
        signature,
      ]);
      const value = signatureStatus.value[0];

      if (value) {
        confirmationStatus = value.confirmationStatus;
        signatureValue = value;
      }

      try {
        await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
        });
      } catch (e) {
        console.log("Retry failed...");
      }

      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return signatureValue;
  };

  const createAndSendTx = async (ixs: TransactionInstruction[]) => {
    const blockhashInfo = await connection.getLatestBlockhash();

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: walletKeypair.publicKey,
        recentBlockhash: blockhashInfo.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: COMPUTE_UNITS,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: PRIORITY_FEES,
          }),
          ...ixs,
        ],
      }).compileToV0Message()
    );

    tx.sign([walletKeypair]);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    console.log("signature:", signature);

    const signatureStatus = await confirmSignatureStatuses({
      signature,
      connection,
      tx,
    });
    console.log("signatureStatus", signatureStatus);
    if (signatureStatus.err) throw new Error("failed to send tx");
  };

  const createSquadBatchTransaction = async ({
    transactionIndex,
    transactionMessages,
  }: {
    transactionIndex: bigint;
    transactionMessages: {
      message: TransactionMessage;
      addressLookupTableAccounts?: AddressLookupTableAccount[];
    }[];
  }) => {
    const createVaultIx = multisig.instructions.batchCreate({
      multisigPda: MS_ADDRESS,
      batchIndex: transactionIndex,
      creator: walletKeypair.publicKey,
      rentPayer: walletKeypair.publicKey,
      vaultIndex: VAULT_INDEX,
      memo: undefined,
      programId: process.env.NEXT_PUBLIC_PROGRAM_ID
        ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
        : undefined,
    });
    const createProposalIx = multisig.instructions.proposalCreate({
      multisigPda: MS_ADDRESS,
      transactionIndex,
      creator: walletKeypair.publicKey,
      rentPayer: walletKeypair.publicKey,
      isDraft: true,
      programId: process.env.NEXT_PUBLIC_PROGRAM_ID
        ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
        : undefined,
    });

    await createAndSendTx([createVaultIx, createProposalIx]);

    for (const [
      index,
      { message, addressLookupTableAccounts },
    ] of transactionMessages.entries()) {
      const batchIx = multisig.instructions.batchAddTransaction({
        vaultIndex: VAULT_INDEX,
        multisigPda: MS_ADDRESS,
        member: walletKeypair.publicKey,
        rentPayer: walletKeypair.publicKey,
        batchIndex: transactionIndex,
        transactionIndex: index + 1,
        ephemeralSigners: 0,
        transactionMessage: message,
        addressLookupTableAccounts,
        programId: process.env.NEXT_PUBLIC_PROGRAM_ID
          ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
          : undefined,
      });
      await createAndSendTx([batchIx]);
    }

    const proposalActivateIx = multisig.instructions.proposalActivate({
      multisigPda: MS_ADDRESS,
      transactionIndex,
      member: walletKeypair.publicKey,
      programId: process.env.NEXT_PUBLIC_PROGRAM_ID
        ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
        : undefined,
    });
    await createAndSendTx([proposalActivateIx]);
  };

  const main = async () => {
    try {
      const data = await readCsvFile(argv.csvFilePath);

      const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        MS_ADDRESS
      );

      const keyIsMember = !!msAccount.members.find((member) => member.key.toBase58() === walletKeypair.publicKey.toBase58());
      if (!keyIsMember) {
        throw new Error("This key is not a member of the squad");
      }

      const [vaultPda] = multisig.getVaultPda({
        multisigPda: MS_ADDRESS,
        index: VAULT_INDEX,
        programId: new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
      });

      const mints = new Map<
        string,
        { tokenProgram: PublicKey; decimals: number }
      >();

      // Prepare mint data
      for (const row of data) {
        if (!mints.has(row.token_address)) {
          const mintAccount = await connection.getAccountInfo(
            new PublicKey(row.token_address)
          );

          if (mintAccount) {
            const mintData = MintLayout.decode(mintAccount.data);

            mints.set(row.token_address, {
              tokenProgram: mintAccount.owner || TOKEN_PROGRAM_ID,
              decimals: mintData.decimals,
            });
          }
        }
      }

      // Generate instructions
      const ixs = data.map((row) => {
        const instructions = [];

        const TOKEN_PROGRAM = mints.get(row.token_address)?.tokenProgram;
        const decimals = mints.get(row.token_address)?.decimals || 9;

        const destinationATA = getAssociatedTokenAddressSync(
          new PublicKey(row.token_address),
          new PublicKey(row.receiver),
          true,
          TOKEN_PROGRAM
        );

        const sourceATA = getAssociatedTokenAddressSync(
          new PublicKey(row.token_address),
          vaultPda,
          true,
          TOKEN_PROGRAM
        );

        const createATAIx = createAssociatedTokenAccountIdempotentInstruction(
          vaultPda,
          destinationATA,
          new PublicKey(row.receiver),
          new PublicKey(row.token_address),
          TOKEN_PROGRAM
        );
        instructions.push(createATAIx);

        const transferIx = createTransferCheckedInstruction(
          sourceATA,
          new PublicKey(row.token_address),
          destinationATA,
          vaultPda,
          BigInt(
            (Number(row.amount.replace(",", "")) * 10 ** decimals).toFixed(0)
          ),
          decimals,
          [],
          TOKEN_PROGRAM
        );
        instructions.push(transferIx);
        return instructions;
      });

      // Create batches of 5 transfers + create ATA
      const batchSize = 5;
      const instructionBatches = [];
      for (let i = 0; i < ixs.length; i += batchSize) {
        const batch = ixs.slice(i, i + batchSize).flat(); // Flatten to combine instructions in each batch
        instructionBatches.push(batch);
      }

      const maxInstructionsPerGroup = 250; // Maximum number of instructions per group
      const groupedInstructionBatches = [];
      for (
        let i = 0;
        i < instructionBatches.length;
        i += maxInstructionsPerGroup
      ) {
        const batch = instructionBatches.slice(i, i + maxInstructionsPerGroup); // Flatten to combine instructions in each batch
        groupedInstructionBatches.push(batch);
      }

      const addressLookupTableAccounts: AddressLookupTableAccount[] = [];
      try {
        const altResult = await connection.getAddressLookupTable(
          new PublicKey("9gioRTKjaKv5P2u3YmVNL3LoCUBqTZHNsGUJXQiN8ueC")
        );
        if (altResult && altResult.value) {
          addressLookupTableAccounts.push(altResult.value);
        }
      } catch (e) {
        console.debug(e);
      }

      for (const [index, group] of groupedInstructionBatches.entries()) {
        await createSquadBatchTransaction({
          transactionIndex:
            BigInt(msAccount.transactionIndex.toString()) + BigInt(index + 1),
          transactionMessages: group.map((ixs) => {
            return {
              message: new TransactionMessage({
                instructions: ixs,
                payerKey: vaultPda,
                recentBlockhash: PublicKey.default.toBase58(),
              }),
              addressLookupTableAccounts,
            };
          }),
        });
      }
    } catch (error) {
      console.error("Error:", error);
    }
  };

  await main();
})();
