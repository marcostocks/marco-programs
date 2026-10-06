/**
 * Mock custodian.
 *
 * Settlement is manual so tests can hold a trade at T+0 and prove the saga
 * waits. Documents are real bytes so the attestation hash in tests is a genuine
 * SHA-256 of genuine content, not a placeholder.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../domain/clock.js';
import { CounterpartyRejection } from '../../domain/errors.js';
import { zero, type Money, type Quantity } from '../../domain/money.js';
import type {
  CorporateAction,
  Custodian,
  CustodyDocument,
  CustodyPosition,
  CustodyStatementLine,
  DeliveryInstruction,
  RequestDeliveryRequest,
  SettlementRecord,
} from '../../ports/custodian.js';
import type { CounterpartyEvent, RawWebhook, WebhookVerification } from '../../ports/webhook.js';
import { headerValue } from './msb.js';

export interface MockCustodianOptions {
  readonly clock: Clock;
  readonly webhookSecret: string;
  readonly accountRef?: string;
  /** Settle on acknowledgement instead of waiting for `settle()`. */
  readonly autoSettle?: boolean;
}

interface PositionRow {
  settled: bigint;
  pendingIn: bigint;
  pendingOut: bigint;
}

export class MockCustodian implements Custodian {
  readonly id = 'mock-custodian';

  private readonly positions = new Map<string, PositionRow>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly documents = new Map<string, CustodyDocument>();
  private readonly deliveries = new Map<string, DeliveryInstruction>();
  private readonly statement: CustodyStatementLine[] = [];
  private readonly corporateActions: CorporateAction[] = [];
  private sequence = 0;

  constructor(private readonly options: MockCustodianOptions) {}

  private get accountRef(): string {
    return this.options.accountRef ?? 'MARCO-CUSTODY-01';
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${String(this.sequence).padStart(8, '0')}`;
  }

  private row(ticker: string): PositionRow {
    let row = this.positions.get(ticker);
    if (!row) {
      row = { settled: 0n, pendingIn: 0n, pendingOut: 0n };
      this.positions.set(ticker, row);
    }
    return row;
  }

  async listPositions(accountRef: string): Promise<CustodyPosition[]> {
    if (accountRef !== this.accountRef) return [];
    return [...this.positions.entries()].map(([ticker, row]) => ({
      ticker,
      settled: { ticker, units: row.settled },
      pendingIn: { ticker, units: row.pendingIn },
      pendingOut: { ticker, units: row.pendingOut },
      accountRef,
      asOf: this.options.clock.nowIso(),
    }));
  }

  async getPosition(accountRef: string, ticker: string): Promise<CustodyPosition | null> {
    if (accountRef !== this.accountRef) return null;
    const row = this.positions.get(ticker);
    if (!row) return null;
    return {
      ticker,
      settled: { ticker, units: row.settled },
      pendingIn: { ticker, units: row.pendingIn },
      pendingOut: { ticker, units: row.pendingOut },
      accountRef,
      asOf: this.options.clock.nowIso(),
    };
  }

  /**
   * Test hook: the custodian acknowledges a trade from the broker.
   * `side` decides whether the shares are arriving or leaving.
   */
  async acknowledgeTrade(
    tradeReference: string,
    ticker: string,
    quantity: Quantity,
    consideration: Money,
    side: 'BUY' | 'SELL' = 'BUY',
  ): Promise<SettlementRecord> {
    const existing = this.settlements.get(tradeReference);
    if (existing) return existing;

    const row = this.row(ticker);
    if (side === 'BUY') row.pendingIn += quantity.units;
    else row.pendingOut += quantity.units;

    const record: SettlementRecord = {
      settlementId: this.nextId('STL'),
      tradeReference,
      ticker,
      status: 'PENDING',
      quantity,
      consideration,
      settledAt: null,
      // HKEX equities settle T+2.
      expectedSettlementDate: new Date(
        this.options.clock.nowMillis() + 2 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      positionReference: null,
      documentRef: null,
      failureReason: null,
    };
    this.settlements.set(tradeReference, record);

    if (this.options.autoSettle) return this.settle(tradeReference, side);
    return record;
  }

  /** Test hook: settlement completes and the attestation documents exist. */
  async settle(tradeReference: string, side: 'BUY' | 'SELL' = 'BUY'): Promise<SettlementRecord> {
    const record = this.settlements.get(tradeReference);
    if (!record) {
      throw new CounterpartyRejection('mock-custodian', `Unknown trade ${tradeReference}`);
    }
    if (record.status === 'SETTLED') return record;

    const row = this.row(record.ticker);
    if (side === 'BUY') {
      row.pendingIn -= record.quantity.units;
      row.settled += record.quantity.units;
    } else {
      row.pendingOut -= record.quantity.units;
      row.settled -= record.quantity.units;
    }

    const documentRef = this.nextId('DOC');
    const contractNote =
      `MARCO CONTRACT NOTE\n` +
      `trade=${tradeReference}\n` +
      `account=${this.accountRef}\n` +
      `ticker=${record.ticker}\n` +
      `quantity=${record.quantity.units}\n` +
      `consideration=${record.consideration.amount} ${record.consideration.currency}\n` +
      `settled=${this.options.clock.nowIso()}\n`;

    this.documents.set(documentRef, {
      documentRef,
      contentType: 'text/plain',
      bytes: Buffer.from(contractNote, 'utf8'),
      issuedAt: this.options.clock.nowIso(),
    });

    const settled: SettlementRecord = {
      ...record,
      status: 'SETTLED',
      settledAt: this.options.clock.nowIso(),
      positionReference: this.nextId('POS'),
      documentRef,
    };
    this.settlements.set(tradeReference, settled);

    this.statement.push({
      id: this.nextId('CST'),
      postedAt: this.options.clock.nowIso(),
      ticker: record.ticker,
      units: side === 'BUY' ? record.quantity.units : -record.quantity.units,
      description: `${side} settlement ${tradeReference}`,
      relatedReference: tradeReference,
    });

    return settled;
  }

  /** Test hook: settlement fails at the custodian. */
  async failSettlement(tradeReference: string, reason: string): Promise<SettlementRecord> {
    const record = this.settlements.get(tradeReference);
    if (!record) {
      throw new CounterpartyRejection('mock-custodian', `Unknown trade ${tradeReference}`);
    }
    const failed: SettlementRecord = { ...record, status: 'FAILED', failureReason: reason };
    this.settlements.set(tradeReference, failed);
    return failed;
  }

  async getSettlementByTrade(tradeReference: string): Promise<SettlementRecord | null> {
    return this.settlements.get(tradeReference) ?? null;
  }

  async listSettlements(from: string, to: string): Promise<SettlementRecord[]> {
    return [...this.settlements.values()].filter(
      (record) => record.expectedSettlementDate >= from && record.expectedSettlementDate <= to,
    );
  }

  async getDocument(documentRef: string): Promise<CustodyDocument | null> {
    return this.documents.get(documentRef) ?? null;
  }

  async requestDelivery(request: RequestDeliveryRequest): Promise<DeliveryInstruction> {
    const existing = this.deliveries.get(request.clientRef);
    if (existing) return existing;

    const row = this.row(request.ticker);
    if (row.settled < request.quantity.units) {
      const rejected: DeliveryInstruction = {
        clientRef: request.clientRef,
        custodianRef: null,
        status: 'REJECTED',
        ticker: request.ticker,
        quantity: request.quantity,
        beneficiaryRef: request.beneficiaryRef,
        requestedAt: this.options.clock.nowIso(),
        deliveredAt: null,
        rejectReason: `Holding of ${row.settled} is short of the ${request.quantity.units} requested`,
      };
      this.deliveries.set(request.clientRef, rejected);
      return rejected;
    }

    const instruction: DeliveryInstruction = {
      clientRef: request.clientRef,
      custodianRef: this.nextId('DLV'),
      status: 'REQUESTED',
      ticker: request.ticker,
      quantity: request.quantity,
      beneficiaryRef: request.beneficiaryRef,
      requestedAt: this.options.clock.nowIso(),
      deliveredAt: null,
      rejectReason: null,
    };
    this.deliveries.set(request.clientRef, instruction);
    return instruction;
  }

  async getDelivery(clientRef: string): Promise<DeliveryInstruction | null> {
    return this.deliveries.get(clientRef) ?? null;
  }

  /** Test hook: shares reach the holder's own broker. */
  async completeDelivery(clientRef: string): Promise<DeliveryInstruction> {
    const instruction = this.deliveries.get(clientRef);
    if (!instruction) {
      throw new CounterpartyRejection('mock-custodian', `Unknown delivery ${clientRef}`);
    }
    const row = this.row(instruction.ticker);
    row.settled -= instruction.quantity.units;

    const delivered: DeliveryInstruction = {
      ...instruction,
      status: 'DELIVERED',
      deliveredAt: this.options.clock.nowIso(),
    };
    this.deliveries.set(clientRef, delivered);
    return delivered;
  }

  async listStatement(accountRef: string, from: string, to: string): Promise<CustodyStatementLine[]> {
    if (accountRef !== this.accountRef) return [];
    return this.statement.filter((line) => line.postedAt >= from && line.postedAt <= to);
  }

  async listCorporateActions(from: string, to: string): Promise<CorporateAction[]> {
    return this.corporateActions.filter((action) => action.exDate >= from && action.exDate <= to);
  }

  seedCorporateAction(action: CorporateAction): void {
    this.corporateActions.push(action);
  }

  /**
   * Test hook: force a position off-book, to prove reconciliation actually
   * catches a custody discrepancy rather than assuming one can never happen.
   */
  forcePosition(ticker: string, settled: bigint): void {
    const row = this.row(ticker);
    row.settled = settled;
  }

  seedPosition(ticker: string, settled: bigint): void {
    this.positions.set(ticker, { settled, pendingIn: 0n, pendingOut: 0n });
  }

  /* ---- Webhooks -------------------------------------------------------- */

  verifyWebhook(raw: RawWebhook): WebhookVerification {
    const signature = headerValue(raw, 'x-custodian-signature');
    const timestamp = headerValue(raw, 'x-custodian-timestamp');
    if (!signature || !timestamp) {
      return { valid: false, reason: 'Missing signature or timestamp header' };
    }
    const expected = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestamp}.${raw.body.toString('utf8')}`)
      .digest('hex');
    const provided = Buffer.from(signature, 'utf8');
    const computed = Buffer.from(expected, 'utf8');
    if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
      return { valid: false, reason: 'Signature mismatch' };
    }
    return {
      valid: true,
      deliveryId: headerValue(raw, 'x-custodian-delivery') ?? undefined,
      signedAt: new Date(Number(timestamp) * 1000).toISOString(),
    };
  }

  parseWebhook(raw: RawWebhook): CounterpartyEvent[] {
    const payload = JSON.parse(raw.body.toString('utf8')) as {
      id?: string;
      type?: string;
      tradeReference?: string;
      occurredAt?: string;
      data?: unknown;
    };
    return [
      {
        source: 'custodian',
        kind: payload.type ?? 'unknown',
        deliveryId: payload.id ?? 'unknown',
        occurredAt: payload.occurredAt ?? raw.receivedAt,
        clientRef: payload.tradeReference,
        data: payload.data ?? {},
      },
    ];
  }

  signWebhook(payload: unknown, timestampSeconds: number): RawWebhook {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestampSeconds}.${body.toString('utf8')}`)
      .digest('hex');
    return {
      body,
      headers: {
        'x-custodian-signature': signature,
        'x-custodian-timestamp': String(timestampSeconds),
        'x-custodian-delivery': `dlv_${timestampSeconds}`,
      },
      receivedAt: this.options.clock.nowIso(),
    };
  }
}

export const zeroHkd = (): Money => zero('HKD');
