# India feasibility assessment — 2026-11-09

This is a technical/product feasibility screen, not legal, tax, regulatory or production-provider approval. The intended Indian studio workflow is **not supported by the current US PayPal Sandbox sender**. No production transaction has been attempted.

| Area | Assessment | Evidence / required verification |
|---|---|---|
| Current PayPal Sandbox demo | **Supported only as a US-sandbox demonstration** | Existing US sender receipts; does not represent an Indian studio sender. |
| Indian domestic PayPal contractor payouts | **Unsupported for the proposed workflow** | PayPal India documentation describes receiving international commercial payments, not domestic Indian PayPal payments [1](https://sbnri.com/remittance/how-to-use-paypal-in-india). Provider production eligibility must be reconfirmed directly. |
| Indian sender funding outbound Payouts | **Requires a different payment provider** | Existing sandbox evidence already shows India sender `PAYOUT_NOT_AVAILABLE`; current architecture must not imply otherwise. |
| RazorpayX bank payouts | **Candidate, requires merchant verification** | Official docs describe payouts after signup, activation and KYC, using Contact + Fund Account; amount, fees and tax debit the business balance [2](https://d6xcmfyh68wv8.cloudfront.net/docs/x/payouts/). |
| IMPS | **Candidate, account/bank conditions apply** | RazorpayX documents bank-account IMPS up to ₹5 lakh per transaction and 24×7 processing [2](https://d6xcmfyh68wv8.cloudfront.net/docs/x/payouts/). Actual enabled account and beneficiary-bank outcome need testing. |
| UPI payouts | **Candidate with restrictions** | RazorpayX documents VPA payouts up to ₹1 lakh; availability depends on account/bank configuration [2](https://d6xcmfyh68wv8.cloudfront.net/docs/x/payouts/). Do not promise universal UPI payout support. |
| NEFT/RTGS | **Candidate, limits/windows apply** | Same official payout-mode matrix [2](https://d6xcmfyh68wv8.cloudfront.net/docs/x/payouts/). Confirm enabled bank and current operating windows. |
| Recipient onboarding/KYC | **Requires provider implementation and verification** | Contacts and Fund Accounts are required [2](https://d6xcmfyh68wv8.cloudfront.net/docs/x/payouts/). Account-activation documents vary by entity and signatory [3](https://razorpay.com/docs/payments/account-activation-support). |
| Test environment | **Candidate, not production proof** | RazorpayX documents test-mode contacts, fund accounts and payouts isolated from live mode [4](https://curlec.com/docs/api/x/). No integration is implemented here. |
| Cleared-funds model | **Compatible in principle** | RazorpayX requires pre-funded business balance; insufficient balance can fail or queue [5](https://razorpay.com/docs/us/api/x/payouts/create/bank-account/?preferred-country=IN). Settle must read authoritative balance/status, not infer cash from invoices. |
| Currency | **Requires redesign** | Current allocation and PayPal execution are USD-only. Indian domestic rails require integer paise/INR, explicit FX policy for cross-border receipts, and no mixed-currency summation. |
| Settlement timelines | **Requires per-rail verification** | Immediate/within-hours labels are provider processing claims, not guaranteed beneficiary outcomes. Final status and UTR must be reconciled. |
| Failed/reversed transfers | **Requires new lifecycle adapter** | Provider responses include queued/processing/failed/reversed states and reasons [6](https://razorpay.com/docs/us/api/x/payouts/fetch-all/?preferred-country=IN). Recovery must preserve obligations and prevent blind retry. |
| Refunds/reversals | **Requires legal/provider review and owner-only controls** | No agent-initiated reversal is authorized. A payout reversal is not a general contractual refund. |
| Contractor vs employee | **Requires legal review** | The product must not label salary payroll and contractor payments interchangeably. Classification, statutory benefits and withholding depend on the actual relationship. |
| TDS/tax | **Requires Indian tax professional validation** | Professional/technical/contract categories can have different withholding treatment. Current sources report changed thresholds/rates over time [7](https://www.canarahsbclife.com/blog/tax-savings/what-is-section-194j). Settle currently calculates no TDS and cannot claim net contractual compliance. |
| GST/accounting | **Requires professional validation** | Invoice, export, place-of-supply, GST and accounting treatment are not implemented. PayPal fee estimates are not tax computations. |
| RBI/cross-border rules | **Requires current official/provider/legal review** | Purpose codes, export documentation, FIRA and cross-border eligibility depend on the flow. A US sandbox receipt proves none of them. |
| DPDP/data protection | **Requires compliance design/review** | Payee identity, bank details, decision records and model prompts need purpose limitation, access control, retention/deletion policy, processor contracts and security safeguards. Current immutable audit design must be reconciled with applicable erasure/retention duties; do not store bank secrets in model prompts. |
| Record retention | **Requires legal retention schedule** | Tax, provider and data-protection retention can differ. The current database has migrations but no retention/deletion policy or legal review. |

## Product consequence

Keep PayPal Sandbox for the hackathon proof, explicitly labelled as a US test sender. For an actual Indian studio, implement a provider adapter only after merchant/account confirmation, beginning with INR integer-paise bank payouts, recipient verification, authoritative balance, webhooks/status reconciliation and owner-only recovery. Do not describe RazorpayX as integrated or production-validated: it is currently a documented candidate.

## External approvals still required

1. Indian studio entity and provider KYC/production eligibility.
2. Enabled rails, fees, limits, test access and webhook behavior from the selected provider.
3. Indian legal review of worker classification, contractual partial-payment/deferral terms and reversal authority.
4. Indian tax review of TDS/GST/accounting and record retention.
5. DPDP/privacy/security review, including model-provider processing and cross-border data flows.
