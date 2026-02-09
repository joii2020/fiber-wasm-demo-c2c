import {
    ClientPublicTestnet,
    SignerCkbPrivateKey,
    Transaction,
    bytesFrom,
    hexFrom,
    stringify,
} from "@ckb-ccc/core";
import {
    Fiber,
    randomSecretKey,
    type CkbJsonRpcTransaction,
    type OpenChannelWithExternalFundingResult,
} from "@nervosnetwork/fiber-js";
import type { HexString, InvoiceResult, NewInvoiceParams } from "@nervosnetwork/fiber-js";

const parseCkbRpcUrl = (config: string): string => {
    const match = config.match(/rpc_url:\s*["']([^"']+)["']/);
    if (!match?.[1]) {
        throw new Error("CKB rpc_url not found in fiber-config-testnet.yml");
    }
    return match[1];
};

export async function getCkbBalance(secretKey: string): Promise<bigint> {
    const config = await loadConfig();
    const rpcUrl = parseCkbRpcUrl(config);
    const client = new ClientPublicTestnet({ url: rpcUrl });
    const signer = new SignerCkbPrivateKey(client, secretKey);
    const address = await signer.getAddressObjSecp256k1();
    console.log(`Address: ${address.toString()}`)
    return client.getCellsCapacity({
        script: address.script,
        scriptType: "lock",
        scriptSearchMode: "exact",
    });
}

export type RelayNodeInfo = {
    peerId: string;
    address: string;
};

const parseRelayPeerId = (address: string) =>
    address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";

export const relayNodeInfo = {
    address: "/ip4/127.0.0.1/tcp/8248/ws/p2p/QmdzY4DaMZjcB7tW91njRkHj8uootQXyzbFrxXTSVsQqEp",
};

export const getRelayNodeInfo = (): RelayNodeInfo => {
    const peerId = parseRelayPeerId(relayNodeInfo.address);
    return { address: relayNodeInfo.address, peerId };
};

export const updateRelayNodeInfo = (next: { address: string }) => {
    relayNodeInfo.address = next.address;
};

const nodeAKey = "0x7ab050ecf4375b1e2faa3c7331c3071582830a07d14c36990b4d3893bddec399";
const nodeBKey = "0xe1c4e6d87ed8bb389d625aca2bd600427dab59a5c665ced090698640cf596570";
export const defaultNodeKeys = {
    A: nodeAKey,
    B: nodeBKey,
} as const;

const CKB_SHANNONS = 100000000n;
const DEFAULT_FUNDING_AMOUNT = 1000n;
const DEFAULT_FUNDING_AMOUNT_HEX = `0x${(DEFAULT_FUNDING_AMOUNT * CKB_SHANNONS).toString(16)}` as `0x${string}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Timer {
    private label: string;
    private startAt: number;

    constructor(label: string) {
        this.label = label;
        this.startAt = Timer.now();
    }

    stop() {
        const durationMs = Timer.now() - this.startAt;
        console.log(`${this.label} took ${durationMs.toFixed(2)}ms`);
        return durationMs;
    }

    private static now() {
        return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    }
}

let configPromise: Promise<string> | null = null;
const loadConfig = () => {
    if (!configPromise) {
        configPromise = fetch("/fiber-config-testnet.yml").then(async (response) => {
            if (!response.ok) {
                throw new Error(`Load config failed: ${response.statusText}`);
            }
            return response.text();
        });
    }
    return configPromise;
};

export const isValidKey = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value.trim());

let fiberWasmBuildLogged = false;
const logFiberWasmBuildTime = () => {
    if (fiberWasmBuildLogged) {
        return;
    }
    fiberWasmBuildLogged = true;
    console.info(`[fiber-wasm] build time: ${import.meta.env.VITE_FIBER_WASM_BUILD_TIME}`);
};

/** Convert CKB JSON-RPC transaction to @ckb-ccc Transaction format */
function ckbJsonRpcTxToCccTx(tx: CkbJsonRpcTransaction): import("@ckb-ccc/core").Transaction {
    const numFrom = (v: string | bigint) =>
        typeof v === "bigint" ? v : BigInt(v.startsWith("0x") ? v : `0x${v}`);
    return Transaction.from({
        version: numFrom(tx.version ?? "0x0"),
        cellDeps: (tx.cell_deps ?? []).map((d) => ({
            outPoint: {
                txHash: d.out_point.tx_hash,
                index: numFrom(d.out_point.index),
            },
            // JSON-RPC uses "dep_group" while @ckb-ccc uses "depGroup"
            depType: d.dep_type === "dep_group" ? "depGroup" : "code",
        })),
        headerDeps: tx.header_deps ?? [],
        inputs: (tx.inputs ?? []).map((i) => ({
            previousOutput: {
                txHash: i.previous_output.tx_hash,
                index: numFrom(i.previous_output.index),
            },
            since: numFrom(i.since ?? "0x0"),
        })),
        outputs: (tx.outputs ?? []).map((o) => ({
            capacity: numFrom(o.capacity),
            lock: {
                codeHash: o.lock.code_hash,
                hashType: o.lock.hash_type as "type" | "data" | "data1" | "data2",
                args: o.lock.args,
            },
            type: o.type
                ? {
                    codeHash: o.type.code_hash,
                    hashType: o.type.hash_type as "type" | "data" | "data1" | "data2",
                    args: o.type.args,
                }
                : undefined,
        })),
        outputsData: tx.outputs_data ?? [],
        witnesses: tx.witnesses ?? [],
    });
}

/** Convert @ckb-ccc Transaction back to CKB JSON-RPC format for submit */
function cccTxToCkbJsonRpcTx(tx: import("@ckb-ccc/core").Transaction): CkbJsonRpcTransaction {
    const toHex = (v: bigint) => `0x${v.toString(16)}` as HexString;
    return {
        version: toHex(tx.version) as HexString,
        cell_deps: tx.cellDeps.map((d) => ({
            dep_type: d.depType === "depGroup" ? "dep_group" : "code",
            out_point: {
                tx_hash: d.outPoint.txHash as HexString,
                index: toHex(d.outPoint.index),
            },
        })),
        header_deps: tx.headerDeps.map((h) => h as HexString),
        inputs: tx.inputs.map((i) => ({
            previous_output: {
                tx_hash: i.previousOutput.txHash as HexString,
                index: toHex(i.previousOutput.index),
            },
            since: toHex(i.since),
        })),
        outputs: tx.outputs.map((o) => ({
            capacity: toHex(o.capacity),
            lock: {
                code_hash: o.lock.codeHash as HexString,
                hash_type: o.lock.hashType,
                args: o.lock.args,
            },
            type: o.type
                ? {
                    code_hash: o.type.codeHash as HexString,
                    hash_type: o.type.hashType,
                    args: o.type.args,
                }
                : undefined,
        })),
        outputs_data: tx.outputsData.map((d) => d as HexString),
        witnesses: tx.witnesses.map((w) => w as HexString),
    };
}

export class FiberNode {
    private nodeName: string;
    private fiber: Fiber | null = null;

    constructor(name: string) {
        this.nodeName = name;
    }

    hasNode() {
        return this.fiber !== null;
    }

    getFiberKey(): Uint8Array {
        const storageKey = `fiber-key-pair:${this.nodeName}`;
        const storedKey = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
        let fiberKeyPair: Uint8Array;
        if (storedKey && isValidKey(storedKey)) {
            fiberKeyPair = bytesFrom(storedKey);
        } else {
            fiberKeyPair = randomSecretKey();
            if (typeof localStorage !== "undefined") {
                localStorage.setItem(storageKey, hexFrom(fiberKeyPair));
            }
        }
        console.log(`fiber key: ${hexFrom(fiberKeyPair)}`);
        return fiberKeyPair;
    }

    getFiberKeyHex(): string {
        return hexFrom(this.getFiberKey());
    }

    /**
     * Create the fiber node.
     * @param ckbSecretKey - CKB secret key. When localSign is true, pass undefined so fiber does not store the key.
     * @param localSign - If true, use external funding (user signs tx locally). Fiber will not receive the CKB key.
     */
    async createNode(ckbSecretKey: string | undefined, localSign = false) {
        if (this.fiber != null) {
            console.warn(`Node(${this.nodeName}) fiber has been created`);
            return;
        }
        const config = await loadConfig();
        const fiber = new Fiber();

        const fiberKeyPair = this.getFiberKey();
        const ckbKey =
            localSign ? undefined : ckbSecretKey != null ? bytesFrom(ckbSecretKey) : undefined;
        const timer = new Timer(`fiber.start ${this.nodeName}`);
        await fiber.start(
            config,
            fiberKeyPair,
            ckbKey as Uint8Array | undefined,
            undefined,
            "info",
            `/wasm-${this.nodeName}`,
        );
        logFiberWasmBuildTime();
        timer.stop();
        this.fiber = fiber;
    }

    async connectRelay(relayInfo: RelayNodeInfo) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        await this.fiber.connectPeer({ address: relayInfo.address });

        // wait
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const peers = await this.fiber.listPeers();
            console.log(`${JSON.stringify(peers)}`);
            if (peers?.peers?.some((peer: { peer_id?: string }) => peer.peer_id === relayInfo.peerId)) {
                return;
            }
            await sleep(400);
        }
        throw new Error("Relay connection timed out");
    }

    private async getRelayPubkey(relayInfo: RelayNodeInfo) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        const peers = await this.fiber.listPeers();
        const relayPeer = peers?.peers?.find((peer) => peer.peer_id === relayInfo.peerId);
        if (!relayPeer?.pubkey) {
            throw new Error("Relay public key not found.");
        }
        return relayPeer.pubkey;
    }

    async sendRelayFunds(relayInfo: RelayNodeInfo, amountCkb: bigint) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        const relayPubkey = await this.getRelayPubkey(relayInfo);
        const amountHex = `0x${(amountCkb * CKB_SHANNONS).toString(16)}` as `0x${string}`;
        await this.fiber.sendPayment({
            target_pubkey: relayPubkey,
            amount: amountHex,
            keysend: true,
        });
    }

    /**
     * Open a channel. When localSign is true, uses external funding: fiber returns unsigned tx,
     * we sign it locally with ckbSecretKey, then submit.
     */
    async openChannel(
        relayInfo: RelayNodeInfo,
        localSign = false,
        ckbSecretKey?: string,
    ) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        const timer = new Timer(`fiber.openChannel ${this.nodeName}`);

        if (localSign && ckbSecretKey) {
            const config = await loadConfig();
            const rpcUrl = parseCkbRpcUrl(config);
            const client = new ClientPublicTestnet({ url: rpcUrl });
            const signer = new SignerCkbPrivateKey(client, ckbSecretKey);
            const address = await signer.getAddressObjSecp256k1();
            const lockScript = address.script;

            const result: OpenChannelWithExternalFundingResult =
                await this.fiber.openChannelWithExternalFunding({
                    peer_id: relayInfo.peerId,
                    funding_amount: DEFAULT_FUNDING_AMOUNT_HEX,
                    public: true,
                    shutdown_script: {
                        code_hash: lockScript.codeHash,
                        hash_type: lockScript.hashType,
                        args: lockScript.args,
                    },
                    funding_lock_script: {
                        code_hash: lockScript.codeHash,
                        hash_type: lockScript.hashType,
                        args: lockScript.args,
                    },
                });

            const cccTx = ckbJsonRpcTxToCccTx(result.unsigned_funding_tx);
            await signer.prepareTransaction(cccTx);
            const signedTx = await signer.signOnlyTransaction(cccTx);
            const signedJsonTx = cccTxToCkbJsonRpcTx(signedTx);

            console.log(`signedJsonTx: ${stringify(signedJsonTx)}`);
            await this.fiber.submitSignedFundingTx({
                channel_id: result.temporary_channel_id,
                signed_funding_tx: signedJsonTx,
            });
        } else {
            await this.fiber.openChannel({
                peer_id: relayInfo.peerId,
                funding_amount: DEFAULT_FUNDING_AMOUNT_HEX,
                public: true,
            });
        }
        timer.stop();
    }

    async listChannels() {
        if (!this.fiber) {
            return [];
        }
        const result = await this.fiber.listChannels({});
        console.log(`${JSON.stringify(result)}`);
        return result?.channels ?? [];
    }

    async newInvoice(
        preimage: HexString,
        amount: bigint,
        expiry: bigint | null,
        description: string,
    ): Promise<InvoiceResult> {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        if (amount <= 0) {
            throw new Error(`Amount(${amount}) failed`);
        }
        if (expiry != null && expiry <= 0n) {
            throw new Error(`Expiry(${expiry}) failed`);
        }

        const params: NewInvoiceParams = {
            amount: `0x${amount.toString(16)}`,
            currency: "Fibt",
            payment_preimage: preimage,
            hash_algorithm: "sha256",
        };
        if (description) {
            params.description = description;
        }
        if (expiry != null) {
            params.expiry = `0x${expiry.toString(16)}`;
        }

        let res = await this.fiber.newInvoice(params);
        console.log(`newInvoice: ${JSON.stringify(res)}`);
        return res;
    }

    async parseInvoice(invoice: string) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        return await this.fiber.parseInvoice({ invoice });
    }

    async sendPayment(invoice: string) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        const timer = new Timer(`fiber.sendPayment ${this.nodeName}`);
        let res = await this.fiber.sendPayment({ invoice });
        timer.stop();
        console.log(`sendPayment: ${JSON.stringify(res)}`);
        return res;
    }

    async shutdownChannel(channelId: HexString) {
        if (!this.fiber) {
            throw new Error("Fiber node not created.");
        }
        await this.fiber.shutdownChannel({
            channel_id: channelId,
            fee_rate: "0x3FC",
            close_script: {
                "code_hash": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                "hash_type": "type",
                "args": "0xcc015401df73a3287d8b2b19f0cc23572ac8b14d"
            },
        });
    }

    async stopNode() {
        if (!this.fiber) {
            return;
        }
        const timer = new Timer(`fiber.stop ${this.nodeName}`);
        await this.fiber.stop();
        timer.stop();

        this.fiber = null;
    }
}
