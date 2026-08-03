import { useEffect } from 'react';
import { Input, Label, Select, Button } from '@/components/ui';
import { formatCurrency, parseCurrencyValue } from '@/utils';

export interface PendingPlayer {
  name?: string;
  mobile: string;
  amount: string;
}

export interface PaymentFormValues {
  paymentStatus: 'paid' | 'partial' | 'unpaid' | 'refunded';
  paymentMethod: 'cash' | 'upi' | 'mixed' | 'wallet' | '' | null;
  cashAmount: string;
  onlineAmount: string;
  walletAmount: string;
  amountReceived: string;
  pendingPaymentAmount: string;
  billAmount: string;
  addToWallet: boolean;
  extraAmount: string;
  walletBalance: number;
  pendingPlayers?: PendingPlayer[];
}

interface PaymentFormProps {
  values: PaymentFormValues;
  onChange: (values: PaymentFormValues) => void;
  disabled?: boolean;
  showBillAmountField?: boolean;
  readOnlyBillAmount?: boolean;
  hideWalletBalance?: boolean;
  hideAmountReceived?: boolean;
}

const PAYMENT_STATUSES = ['paid', 'partial', 'unpaid', 'refunded'] as const;
const PAYMENT_METHODS = ['cash', 'upi', 'mixed', 'wallet'] as const;

export default function PaymentForm({
  values,
  onChange,
  disabled = false,
  showBillAmountField = false,
  readOnlyBillAmount = false,
  hideWalletBalance = false,
  hideAmountReceived = false
}: PaymentFormProps) {
  // Reset split payment fields when switching to 'mixed' method so all inputs start blank
  // Reset split payment fields when switching to 'mixed' method if it was defaulted to full bill amount
  useEffect(() => {
    if (values.paymentMethod === 'mixed') {
      if (values.cashAmount && Number(values.cashAmount) === Number(values.billAmount) && Number(values.billAmount) > 0) {
        onChange({
          ...values,
          cashAmount: '',
          onlineAmount: '',
          walletAmount: '',
          pendingPaymentAmount: '',
        });
      }
    } else if (values.paymentMethod === 'wallet' && values.billAmount && values.walletBalance > 0) {
      const walletUsed = Math.min(values.walletBalance, Number(values.billAmount));
      const targetWallet = String(walletUsed);
      const targetCash = String(Math.max(0, Number(values.billAmount) - walletUsed));
      if (values.walletAmount !== targetWallet || values.cashAmount !== targetCash) {
        onChange({
          ...values,
          walletAmount: targetWallet,
          cashAmount: targetCash,
          onlineAmount: '',
        });
      }
    } else if (values.paymentMethod !== 'wallet' && values.walletAmount && values.walletAmount !== '') {
      // Reset wallet fields when switching away from wallet payment
      onChange({
        ...values,
        walletAmount: '',
      });
    }
  }, [values.paymentMethod]);

  // Auto-clear payment method if status is 'unpaid'
  useEffect(() => {
    if (values.paymentStatus === 'unpaid' && values.paymentMethod) {
      onChange({
        ...values,
        paymentMethod: '',
        cashAmount: '',
        onlineAmount: '',
        walletAmount: '',
        pendingPaymentAmount: '',
      });
    }
  }, [values.paymentStatus]);

  const handleFieldChange = (field: keyof PaymentFormValues, value: string | boolean) => {
    onChange({ ...values, [field]: value });
  };

  const isPaymentMethodRequired = values.paymentStatus === 'paid' || values.paymentStatus === 'partial';

  return (
    <div className="space-y-3">
      {showBillAmountField && (
        <div className="space-y-1.5">
          <Label>Total Amount / Bill Amount *</Label>
          <Input
            type="text"
            value={readOnlyBillAmount ? formatCurrency(Number(values.billAmount) || 0) : values.billAmount}
            onChange={(e) => handleFieldChange('billAmount', e.target.value)}
            placeholder="Enter total bill amount"
            disabled={readOnlyBillAmount || disabled}
            readOnly={readOnlyBillAmount}
            className={readOnlyBillAmount ? 'bg-muted/50 font-bold text-base text-foreground' : ''}
          />
        </div>
      )}

      <div className={`grid gap-3 ${values.paymentStatus === 'unpaid' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div className="space-y-1.5">
          <Label>Payment Status *</Label>
          <Select
            value={values.paymentStatus}
            onChange={(e) => handleFieldChange('paymentStatus', e.target.value as any)}
            disabled={disabled}
          >
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status} className="capitalize">{status}</option>
            ))}
          </Select>
        </div>
        {values.paymentStatus !== 'unpaid' && (
          <div className="space-y-1.5">
            <Label>Payment Method {isPaymentMethodRequired ? '*' : ''}</Label>
            <Select
              value={values.paymentMethod || ''}
              onChange={(e) => handleFieldChange('paymentMethod', e.target.value as any)}
              disabled={disabled}
            >
              <option value="">Select Payment Method</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method} className="capitalize">
                  {method === 'wallet' ? 'Wallet / Advance Balance' : method}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* Available Wallet Balance */}
      {!hideWalletBalance && (
        <div className="space-y-1.5">
          <Label>Available Wallet Balance</Label>
          <Input
            type="text"
            value={formatCurrency(values.walletBalance || 0)}
            readOnly
            className="bg-muted/50"
          />
        </div>
      )}

      {/* Wallet Calculation Display */}
      {values.paymentMethod === 'wallet' && values.billAmount && (
        <div className="space-y-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Wallet Used</span>
            <span className="text-sm font-semibold text-blue-400">
              {formatCurrency(Math.min(values.walletBalance || 0, Number(values.billAmount) || 0))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Remaining Bill Amount</span>
            <span className="text-sm font-semibold">
              {formatCurrency(Math.max(0, (Number(values.billAmount) || 0) - Math.min(values.walletBalance || 0, Number(values.billAmount) || 0)))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Remaining Wallet Balance</span>
            <span className="text-sm font-semibold text-green-400">
              {formatCurrency(Math.max(0, (values.walletBalance || 0) - Math.min(values.walletBalance || 0, Number(values.billAmount) || 0)))}
            </span>
          </div>
        </div>
      )}

      {/* Amount Received */}
      {!hideAmountReceived && (
        <div className="space-y-1.5">
          <Label>Amount Received</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={values.amountReceived}
            onChange={(e) => handleFieldChange('amountReceived', e.target.value)}
            placeholder="Enter amount received (optional)"
            disabled={disabled}
          />
        </div>
      )}

      {/* Extra Amount Display */}
      {values.amountReceived && Number(values.amountReceived) > 0 && Number(values.billAmount) > 0 && (
        <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Bill Amount</span>
            <span className="text-sm font-semibold">{formatCurrency(Number(values.billAmount) || 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount Received</span>
            <span className="text-sm font-semibold">{formatCurrency(Number(values.amountReceived) || 0)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-sm text-muted-foreground">Extra Amount</span>
            <span className={`text-sm font-semibold ${Number(values.amountReceived) > Number(values.billAmount) ? 'text-green-400' : 'text-muted-foreground'}`}>
              {formatCurrency(Math.max(0, (Number(values.amountReceived) || 0) - (Number(values.billAmount) || 0)))}
            </span>
          </div>
        </div>
      )}

      {/* Wallet Confirmation for Extra Amount */}
      {values.amountReceived && Number(values.amountReceived) > Number(values.billAmount) && (
        <div className="space-y-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Customer paid extra</p>
              <p className="text-sm font-semibold text-green-400">
                {formatCurrency((Number(values.amountReceived) || 0) - (Number(values.billAmount) || 0))}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="addToWallet"
                checked={values.addToWallet}
                onChange={(e) => handleFieldChange('addToWallet', e.target.checked)}
                className="w-4 h-4"
                disabled={disabled}
              />
              <label htmlFor="addToWallet" className="text-sm cursor-pointer">
                Add to Wallet Balance
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Mixed Payment Fields */}
      {values.paymentMethod === 'mixed' && (
        <div className="space-y-3 mt-3 p-3 bg-muted/30 rounded-lg border border-border">
          {values.walletBalance > 0 && (
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Available Wallet Balance</p>
                <p className="text-sm font-semibold text-green-400">
                  {formatCurrency(values.walletBalance)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useWallet"
                  checked={values.walletAmount !== ''}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleFieldChange('walletAmount', String(Math.min(values.walletBalance, Number(values.billAmount) || 0)));
                    } else {
                      handleFieldChange('walletAmount', '');
                    }
                  }}
                  className="w-4 h-4"
                  disabled={disabled}
                />
                <label htmlFor="useWallet" className="text-sm cursor-pointer">
                  Use Wallet Balance
                </label>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cash Amount *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={values.cashAmount}
                onChange={(e) => handleFieldChange('cashAmount', e.target.value)}
                placeholder="Enter cash amount"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Online Amount *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={values.onlineAmount}
                onChange={(e) => handleFieldChange('onlineAmount', e.target.value)}
                placeholder="Enter online amount"
                disabled={disabled}
              />
            </div>
          </div>
          {values.walletAmount !== '' && (
            <div className="space-y-1.5">
              <Label>Wallet Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                max={values.walletBalance}
                value={values.walletAmount}
                onChange={(e) => handleFieldChange('walletAmount', e.target.value)}
                placeholder="Enter wallet amount"
                disabled={disabled}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Pending Payment Amount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={values.pendingPaymentAmount}
              onChange={(e) => handleFieldChange('pendingPaymentAmount', e.target.value)}
              placeholder="Enter pending payment amount"
              disabled={disabled}
            />
          </div>
          {/* Payment Summary */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Total Bill</p>
              <p className="text-sm font-semibold">
                {formatCurrency(Number(values.billAmount) || 0)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Total Paid</p>
              <p className="text-sm font-semibold">
                {formatCurrency((Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0) + (Number(values.walletAmount) || 0))}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Pending Payment</p>
              <p className="text-sm font-semibold text-amber-400">
                {formatCurrency(Math.max(0, (Number(values.billAmount) || 0) - ((Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0) + (Number(values.walletAmount) || 0))))}
              </p>
            </div>
          </div>
          {/* Validation Error */}
          {!((values.pendingPlayers || []).length > 0) &&
           (Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0) + (Number(values.walletAmount) || 0) + (Number(values.pendingPaymentAmount) || 0) > 0 &&
           (Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0) + (Number(values.walletAmount) || 0) + (Number(values.pendingPaymentAmount) || 0) !== (Number(values.billAmount) || 0) && (
            <p className="text-xs text-red-400">
              Total payment (Cash + UPI + Wallet + Pending) must equal the bill amount ({formatCurrency(Number(values.billAmount) || 0)})
            </p>
          )}
          {(Number(values.walletAmount) || 0) > values.walletBalance && (
            <p className="text-xs text-red-400">
              Insufficient wallet balance. Available: {formatCurrency(values.walletBalance)}
            </p>
          )}
        </div>
      )}

      {/* Wallet Payment Fields */}
      {values.paymentMethod === 'wallet' && (
        <div className="space-y-3 mt-3 p-3 bg-muted/30 rounded-lg border border-border">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Available Wallet Balance</p>
              <p className="text-lg font-semibold text-green-400">
                {formatCurrency(values.walletBalance)}
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-xs text-muted-foreground">Bill Amount</p>
              <p className="text-sm font-semibold">
                {formatCurrency(Number(values.billAmount) || 0)}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Wallet Amount to Use *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              max={values.walletBalance}
              value={values.walletAmount}
              onChange={(e) => handleFieldChange('walletAmount', e.target.value)}
              placeholder="Enter wallet amount"
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Maximum: {formatCurrency(values.walletBalance)}
            </p>
          </div>
          {/* Payment Summary */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Wallet Amount Used</p>
              <p className="text-sm font-semibold">
                {formatCurrency(Number(values.walletAmount) || 0)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Remaining Wallet Balance</p>
              <p className="text-sm font-semibold">
                {formatCurrency(values.walletBalance - (Number(values.walletAmount) || 0))}
              </p>
            </div>
          </div>
          {/* Validation Error */}
          {(Number(values.walletAmount) || 0) > values.walletBalance && (
            <p className="text-xs text-red-400">
              Insufficient wallet balance. Available: {formatCurrency(values.walletBalance)}
            </p>
          )}
        </div>
      )}

      {/* Pending Player Payments Section */}
      {values.paymentStatus !== 'refunded' && (
        <div className="space-y-3 pt-3 border-t border-border animate-fade-in">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold text-foreground">
              Pending Player Payments
            </Label>
            {Number(values.billAmount) > 0 && (
              <span className="text-xs font-mono text-muted-foreground">
                Unpaid Balance: {formatCurrency(Math.max(0, (Number(values.billAmount) || 0) - ((Number(values.amountReceived) || 0) > 0 ? (Number(values.amountReceived) || 0) : ((Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0))) - (Number(values.walletAmount) || 0)))}
              </span>
            )}
          </div>

          {(values.pendingPlayers || []).map((player, index) => {
            const currentPlayers = values.pendingPlayers || [];
            const mobileError = player.mobile && player.mobile.length > 0 && player.mobile.length !== 10
              ? 'Mobile number must be exactly 10 digits'
              : currentPlayers.filter((p) => p.mobile && p.mobile === player.mobile).length > 1
              ? 'Duplicate mobile number'
              : '';
            const amountError = player.amount !== '' && Number(player.amount) <= 0
              ? 'Amount must be greater than 0'
              : '';

            return (
              <div key={index} className="p-3 bg-muted/30 rounded-lg border border-border space-y-3 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Player {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (values.pendingPlayers || []).filter((_, i) => i !== index);
                      onChange({ ...values, pendingPlayers: updated });
                    }}
                    disabled={disabled}
                    className="text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Player Name</Label>
                    <Input
                      type="text"
                      value={player.name || ''}
                      onChange={(e) => {
                        const updated = (values.pendingPlayers || []).map((p, i) => i === index ? { ...p, name: e.target.value } : p);
                        onChange({ ...values, pendingPlayers: updated });
                      }}
                      placeholder="Player name (optional)"
                      disabled={disabled}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Mobile Number *</Label>
                    <Input
                      type="text"
                      value={player.mobile}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                        const updated = (values.pendingPlayers || []).map((p, i) => i === index ? { ...p, mobile: cleaned } : p);
                        onChange({ ...values, pendingPlayers: updated });
                      }}
                      placeholder="10-digit mobile number"
                      maxLength={10}
                      disabled={disabled}
                      className={mobileError ? 'border-red-500 focus:ring-red-500' : ''}
                    />
                    {mobileError && <p className="text-xs text-red-400">{mobileError}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Pending Amount *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={player.amount}
                      onChange={(e) => {
                        const updated = (values.pendingPlayers || []).map((p, i) => i === index ? { ...p, amount: e.target.value } : p);
                        onChange({ ...values, pendingPlayers: updated });
                      }}
                      placeholder="Enter pending amount"
                      disabled={disabled}
                      className={amountError ? 'border-red-500 focus:ring-red-500' : ''}
                    />
                    {amountError && <p className="text-xs text-red-400">{amountError}</p>}
                  </div>
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const current = values.pendingPlayers || [];
              onChange({ ...values, pendingPlayers: [...current, { mobile: '', amount: '' }] });
            }}
            disabled={disabled}
            className="w-full border-dashed"
          >
            + Add Extra Player Pending Payment
          </Button>

          {/* Validation summary error if total doesn't balance */}
          {(() => {
            const billAmt = Number(values.billAmount) || 0;
            const rawRec = Number(values.amountReceived) || 0;
            const cashAmt = Number(values.cashAmount) || 0;
            const onlineAmt = Number(values.onlineAmount) || 0;
            const walletAmt = Number(values.walletAmount) || 0;

            let receivedAmt = 0;
            if (values.paymentMethod === 'mixed') {
              receivedAmt = cashAmt + onlineAmt;
            } else if (values.paymentMethod === 'wallet') {
              receivedAmt = 0;
            } else {
              receivedAmt = rawRec > 0 ? rawRec : (cashAmt + onlineAmt);
            }

            // When extra pending players exist, only count pendingPaymentAmount if explicitly set in mixed payment mode
            const mainPendingAmt = values.paymentMethod === 'mixed' ? (Number(values.pendingPaymentAmount) || 0) : 0;
            const totalPendingAmt = (values.pendingPlayers || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

            const totalAllocated = Math.round((receivedAmt + walletAmt + mainPendingAmt + totalPendingAmt) * 100) / 100;
            const roundedBillAmt = Math.round(billAmt * 100) / 100;

            const hasPendingPlayers = (values.pendingPlayers || []).length > 0;

            if (hasPendingPlayers && roundedBillAmt > 0 && Math.abs(totalAllocated - roundedBillAmt) > 0.01) {
              const remaining = Math.round((roundedBillAmt - totalAllocated) * 100) / 100;
              if (remaining > 0) {
                return (
                  <div className="space-y-1 p-2.5 bg-red-500/10 rounded-lg border border-red-500/20 text-xs text-red-400 font-medium">
                    <p className="font-semibold text-red-300">Remaining Amount: {formatCurrency(remaining)}</p>
                    <p>
                      Total Allocated ({formatCurrency(totalAllocated)}) must equal Total Bill Amount ({formatCurrency(roundedBillAmt)}).
                    </p>
                  </div>
                );
              } else {
                const overAllocated = Math.round((totalAllocated - roundedBillAmt) * 100) / 100;
                return (
                  <div className="space-y-1 p-2.5 bg-red-500/10 rounded-lg border border-red-500/20 text-xs text-red-400 font-medium">
                    <p className="font-semibold text-red-300">Over-allocated Amount: {formatCurrency(overAllocated)}</p>
                    <p>
                      Total Allocated ({formatCurrency(totalAllocated)}) must equal Total Bill Amount ({formatCurrency(roundedBillAmt)}).
                    </p>
                  </div>
                );
              }
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
}
