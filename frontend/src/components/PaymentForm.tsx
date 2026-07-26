import { useEffect } from 'react';
import { Input, Label, Select } from '@/components/ui';
import { formatCurrency, parseCurrencyValue } from '@/utils';

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
}

interface PaymentFormProps {
  values: PaymentFormValues;
  onChange: (values: PaymentFormValues) => void;
  disabled?: boolean;
  showBillAmountField?: boolean;
  readOnlyBillAmount?: boolean;
}

const PAYMENT_STATUSES = ['paid', 'partial', 'unpaid', 'refunded'] as const;
const PAYMENT_METHODS = ['cash', 'upi', 'mixed', 'wallet'] as const;

export default function PaymentForm({
  values,
  onChange,
  disabled = false,
  showBillAmountField = false,
  readOnlyBillAmount = false
}: PaymentFormProps) {
  // Reset split payment fields when switching to 'mixed' method so all inputs start blank
  useEffect(() => {
    if (values.paymentMethod === 'mixed') {
      if (values.cashAmount === values.billAmount || Number(values.cashAmount) === Number(values.billAmount) || values.onlineAmount === '0' || values.pendingPaymentAmount === '0') {
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

      <div className="grid grid-cols-2 gap-3">
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
      </div>
      
      {/* Available Wallet Balance */}
      <div className="space-y-1.5">
        <Label>Available Wallet Balance</Label>
        <Input
          type="text"
          value={formatCurrency(values.walletBalance || 0)}
          readOnly
          className="bg-muted/50"
        />
      </div>

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
        <p className="text-xs text-muted-foreground">
          Leave empty to assume full payment of {formatCurrency(Number(values.billAmount) || 0)}
        </p>
      </div>

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
          {(Number(values.cashAmount) || 0) + (Number(values.onlineAmount) || 0) + (Number(values.walletAmount) || 0) + (Number(values.pendingPaymentAmount) || 0) > 0 &&
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
    </div>
  );
}
