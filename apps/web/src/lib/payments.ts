import type { Payment, PaymentTotal } from "./types";

export type PaymentDto = Omit<Payment, "amount" | "refundedAmount"> & { amount: number | null; refundedAmount: number | null };
export type PaymentSnapshot = { payments: PaymentDto[]; totals: PaymentTotal[]; configured: boolean };
export const paymentFromDto = (payment: PaymentDto): Payment => ({ ...payment, amount: payment.amount ?? 0, refundedAmount: payment.refundedAmount ?? 0, amountHidden: payment.amount === null });
export const paymentMoney = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(value);

/** Shared paid-minus-refunds definition; pending requests do not count as collected. */
export const collectedPayment = (payment: Payment) => ["paid", "partially_refunded", "refunded"].includes(payment.status)
  ? Math.max(0, payment.amount - (payment.refundedAmount ?? (payment.status === "refunded" ? payment.amount : 0))) : 0;
