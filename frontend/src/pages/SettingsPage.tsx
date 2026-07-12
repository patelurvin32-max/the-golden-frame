import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { branchService, settingsService } from '@/services';
import api from '@/services/api';
import { Button, Card, CardContent, Input, Label, Select, useToast } from '@/components/ui';
import { cn } from '@/utils';
import type { Branch } from '@/types';

type SettingsState = {
  businessName: string;
  logoUrl: string;
  currency: string;
  currencySymbol: string;
  taxPercent: number;
  timezone: string;
  backupEnabled: boolean;
  dailyReportEnabled: boolean;
  dailyReportFromEmail: string;
  dailyReportEmails: string;
  dailyReportBranchIds: string[];
  receipt: {
    templateName: string;
    fontStyle: 'Helvetica' | 'Courier' | 'Times-Roman';
    header: {
      showLogo: boolean;
      businessName: string;
      addressLine1: string;
      addressLine2: string;
      phone: string;
      email: string;
      website: string;
      showAddress: boolean;
      showPhone: boolean;
      showEmail: boolean;
      showWebsite: boolean;
    };
    orderDetails: {
      showTableName: boolean;
      showDuration: boolean;
      showStaffName: boolean;
      showCustomer: boolean;
      showItemizedList: boolean;
      showTax: boolean;
      showDiscount: boolean;
    };
    footer: {
      showThankYou: boolean;
      thankYouMessage: string;
      showTerms: boolean;
      termsText: string;
      showNotes: boolean;
      notesText: string;
      showPaymentInstructions: boolean;
      paymentInstructions: string;
      showBankDetails: boolean;
      bankName: string;
      accountNumber: string;
      ifscCode: string;
      upiId: string;
      showQRCode: boolean;
      showSignature: boolean;
      signatureLabel: string;
    };
  };
};

const createDefaultSettings = (): SettingsState => ({
  businessName: 'The Golden Frame',
  logoUrl: '',
  currency: 'INR',
  currencySymbol: '₹',
  taxPercent: 0,
  timezone: 'Asia/Kolkata',
  backupEnabled: true,
  dailyReportEnabled: true,
  dailyReportFromEmail: '',
  dailyReportEmails: '',
  dailyReportBranchIds: [],
  receipt: {
    templateName: 'The Golden Frame Receipt',
    fontStyle: 'Helvetica',
    header: {
      showLogo: true,
      businessName: '',
      addressLine1: '',
      addressLine2: '',
      phone: '',
      email: '',
      website: '',
      showAddress: true,
      showPhone: true,
      showEmail: false,
      showWebsite: false,
    },
    orderDetails: {
      showTableName: true,
      showDuration: true,
      showStaffName: false,
      showCustomer: true,
      showItemizedList: true,
      showTax: true,
      showDiscount: true,
    },
    footer: {
      showThankYou: true,
      thankYouMessage: 'Thank you for visiting! See you again.',
      showTerms: false,
      termsText: '',
      showNotes: false,
      notesText: '',
      showPaymentInstructions: false,
      paymentInstructions: '',
      showBankDetails: false,
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      upiId: '',
      showQRCode: false,
      showSignature: false,
      signatureLabel: 'Authorized Signature',
    },
  },
});

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none',
        checked ? 'bg-sky-500' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between bg-muted/20 px-5 py-4 text-left transition-colors hover:bg-muted/40"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn('text-muted-foreground transition-transform duration-200', open && 'rotate-180')}>
          ▼
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-border p-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  children,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="cursor-grab text-sm text-muted-foreground/60">≡</span>
          <div>
            <p className="text-sm font-medium">{label}</p>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <Toggle checked={checked} onChange={onChange} />
      </div>
      <AnimatePresence>
        {checked && children ? (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="ml-4 space-y-3"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative rounded-xl border px-5 py-3 text-sm font-semibold transition-all',
        active ? 'border-sky-500 bg-sky-500/10 text-sky-400' : 'border-border text-muted-foreground hover:bg-accent'
      )}
    >
      {children}
      {dot ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-sky-500" /> : null}
    </button>
  );
}

function ReceiptPreview({ settings }: { settings: SettingsState }) {
  const receipt = settings.receipt;
  const header = receipt.header;
  const footer = receipt.footer;
  const currency = settings.currencySymbol || '₹';
  const fontFamily =
    receipt.fontStyle === 'Courier'
      ? 'Courier New, monospace'
      : receipt.fontStyle === 'Times-Roman'
        ? 'Georgia, serif'
        : 'Arial, sans-serif';
  const businessName = header.businessName || settings.businessName || 'The Golden Frame';

  return (
    <div
      className="mx-auto overflow-hidden rounded-xl bg-white text-gray-800 shadow-2xl"
      style={{ width: 320, fontFamily, fontSize: 12 }}
    >
      <div className="space-y-1 bg-gray-900 p-4 text-center text-white">
        {header.showLogo && settings.logoUrl ? (
          <img src={settings.logoUrl} alt="Logo" className="mx-auto mb-2 h-12 w-12 rounded-lg object-contain" />
        ) : null}
        {header.showLogo && !settings.logoUrl ? (
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-600 text-xl">
            CM
          </div>
        ) : null}
        <p className="text-base font-bold">{businessName}</p>
        {header.showAddress && header.addressLine1 ? <p className="text-xs text-gray-300">{header.addressLine1}</p> : null}
        {header.showAddress && header.addressLine2 ? <p className="text-xs text-gray-300">{header.addressLine2}</p> : null}
        {header.showPhone && header.phone ? <p className="text-xs text-gray-300">Phone: {header.phone}</p> : null}
        {header.showEmail && header.email ? <p className="text-xs text-gray-300">Email: {header.email}</p> : null}
        {header.showWebsite && header.website ? <p className="text-xs text-gray-300">Web: {header.website}</p> : null}
      </div>

      <div className="mx-4 my-2 border-t-2 border-dashed border-gray-300" />

      <div className="space-y-1 px-4 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Invoice #</span>
          <span className="font-mono font-bold">INV-20240704-0001</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Date</span>
          <span>04 Jul 2024, 12:40 PM</span>
        </div>
        {receipt.orderDetails.showCustomer ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Customer</span>
            <span>Walk-in</span>
          </div>
        ) : null}
        {receipt.orderDetails.showTableName ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Table</span>
            <span>Pool 1</span>
          </div>
        ) : null}
        {receipt.orderDetails.showDuration ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Duration</span>
            <span>1h 15m</span>
          </div>
        ) : null}
        {receipt.orderDetails.showStaffName ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Staff</span>
            <span>Ravi</span>
          </div>
        ) : null}
      </div>

      <div className="mx-4 my-2 border-t border-dashed border-gray-300" />

      {receipt.orderDetails.showItemizedList ? (
        <div className="space-y-1 px-4 py-2 text-xs">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Items</p>
          <div className="flex justify-between">
            <span>Pool Table (75 min)</span>
            <span className="font-semibold">{currency}375.00</span>
          </div>
          <div className="flex justify-between">
            <span>Cold Drink x2</span>
            <span className="font-semibold">{currency}80.00</span>
          </div>
        </div>
      ) : null}

      <div className="mx-4 my-2 border-t border-dashed border-gray-300" />

      <div className="space-y-1 px-4 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Subtotal</span>
          <span>{currency}455.00</span>
        </div>
        {receipt.orderDetails.showDiscount ? (
          <div className="flex justify-between text-red-500">
            <span>Discount</span>
            <span>-{currency}50.00</span>
          </div>
        ) : null}
        {receipt.orderDetails.showTax ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Tax (0%)</span>
            <span>{currency}0.00</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-gray-200 pt-1 text-sm font-bold">
          <span>TOTAL</span>
          <span className="text-green-600">{currency}405.00</span>
        </div>
        <div className="flex justify-between pt-1 text-xs text-gray-500">
          <span>Payment</span>
          <span>Cash</span>
        </div>
      </div>

      <div className="mx-4 my-2 border-t-2 border-dashed border-gray-300" />

      <div className="space-y-2 px-4 pb-4 text-center text-xs text-gray-500">
        {footer.showThankYou && footer.thankYouMessage ? <p className="font-medium text-gray-700">{footer.thankYouMessage}</p> : null}
        {footer.showTerms && footer.termsText ? (
          <div className="text-left">
            <p className="mb-0.5 text-[10px] font-semibold uppercase text-gray-600">Terms</p>
            <p>{footer.termsText}</p>
          </div>
        ) : null}
        {footer.showNotes && footer.notesText ? (
          <div className="text-left">
            <p className="mb-0.5 text-[10px] font-semibold uppercase text-gray-600">Notes</p>
            <p>{footer.notesText}</p>
          </div>
        ) : null}
        {footer.showPaymentInstructions && footer.paymentInstructions ? <p className="text-left">{footer.paymentInstructions}</p> : null}
        {footer.showBankDetails ? (
          <div className="rounded-lg border border-gray-200 p-2 text-left">
            <p className="mb-1 text-[10px] font-semibold uppercase text-gray-600">Bank Details</p>
            {footer.bankName ? <p>Bank: {footer.bankName}</p> : null}
            {footer.accountNumber ? <p>A/C: {footer.accountNumber}</p> : null}
            {footer.ifscCode ? <p>IFSC: {footer.ifscCode}</p> : null}
            {footer.upiId ? <p>UPI: {footer.upiId}</p> : null}
          </div>
        ) : null}
        {footer.showQRCode ? (
          <div className="flex justify-center pt-2">
            <div className="flex h-16 w-16 items-center justify-center rounded bg-gray-200 text-[10px] text-gray-400">
              QR Code
            </div>
          </div>
        ) : null}
        {footer.showSignature ? (
          <div className="pt-4">
            <div className="mx-auto mb-1 h-8 w-32 border-b border-gray-400" />
            <p className="text-[10px]">{footer.signatureLabel || 'Authorized Signature'}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'brand' | 'receipt' | 'system'>('brand');
  const [settings, setSettings] = useState<SettingsState>(createDefaultSettings());
  const { data: branchesData = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((response) => response.data.data.branches),
  });

  useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      settingsService.get().then((response) => {
        const data = (response.data as any).data?.settings;
        if (data) {
          setSettings((current) => ({
            ...current,
            ...data,
            dailyReportFromEmail: data.dailyReportFromEmail || current.dailyReportFromEmail,
            dailyReportBranchIds: (data.dailyReportBranchIds || []).map((branch: any) => (typeof branch === 'string' ? branch : branch._id)),
            dailyReportEmails: Array.isArray(data.dailyReportEmails)
              ? data.dailyReportEmails.join(', ')
              : Array.isArray(data.dailyReportRecipientEmails)
                ? data.dailyReportRecipientEmails.join(', ')
                : current.dailyReportEmails,
            receipt: {
              ...current.receipt,
              ...(data.receipt || {}),
              header: {
                ...current.receipt.header,
                ...(data.receipt?.header || {}),
              },
              orderDetails: {
                ...current.receipt.orderDetails,
                ...(data.receipt?.orderDetails || {}),
              },
              footer: {
                ...current.receipt.footer,
                ...(data.receipt?.footer || {}),
              },
            },
          }));
        }

        return data;
      }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: SettingsState) => settingsService.update(payload as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved!');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const setTop = (key: keyof Omit<SettingsState, 'receipt'>, value: SettingsState[keyof Omit<SettingsState, 'receipt'>]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const setBranchSelection = (branchId: string, checked: boolean) => {
    setSettings((current) => ({
      ...current,
      dailyReportBranchIds: checked
        ? [...current.dailyReportBranchIds, branchId]
        : current.dailyReportBranchIds.filter((id) => id !== branchId),
    }));
  };

  const setHeader = (key: keyof SettingsState['receipt']['header'], value: string | boolean) => {
    setSettings((current) => ({
      ...current,
      receipt: {
        ...current.receipt,
        header: {
          ...current.receipt.header,
          [key]: value,
        },
      },
    }));
  };

  const setOrderDetails = (key: keyof SettingsState['receipt']['orderDetails'], value: boolean) => {
    setSettings((current) => ({
      ...current,
      receipt: {
        ...current.receipt,
        orderDetails: {
          ...current.receipt.orderDetails,
          [key]: value,
        },
      },
    }));
  };

  const setFooter = (key: keyof SettingsState['receipt']['footer'], value: string | boolean) => {
    setSettings((current) => ({
      ...current,
      receipt: {
        ...current.receipt,
        footer: {
          ...current.receipt.footer,
          [key]: value,
        },
      },
    }));
  };

  const setReceipt = (key: keyof Pick<SettingsState['receipt'], 'templateName' | 'fontStyle'>, value: string) => {
    setSettings((current) => ({
      ...current,
      receipt: {
        ...current.receipt,
        [key]: value,
      },
    }));
  };

  const handleSave = () => saveMutation.mutate(settings);

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);

      const response = await api.post('/settings/upload-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const logoUrl = (response.data as any).data?.logoUrl;
      if (logoUrl) {
        setTop('logoUrl', logoUrl);
      }
      toast.success('Logo uploaded!');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Upload failed');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  const handleRemoveLogo = async () => {
    try {
      await api.delete('/settings/logo');
      setTop('logoUrl', '');
      toast.success('Logo removed');
    } catch {
      toast.error('Failed to remove logo');
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPreview((current) => !current)}>
            {showPreview ? 'Close Preview' : 'Preview Receipt'}
          </Button>
          <Button size="sm" loading={saveMutation.isPending} onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex flex-wrap gap-2">
            <Tab active={activeTab === 'brand'} onClick={() => setActiveTab('brand')}>
              Brand
            </Tab>
            <Tab active={activeTab === 'receipt'} onClick={() => setActiveTab('receipt')} dot>
              Invoice Setting
            </Tab>
            <Tab active={activeTab === 'system'} onClick={() => setActiveTab('system')}>
              System
            </Tab>
          </div>

          {activeTab === 'brand' ? (
            <Card>
              <CardContent className="space-y-6 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Business Profile</h3>

                <div className="space-y-3">
                  <Label>Business Logo</Label>
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30">
                      {settings.logoUrl ? (
                        <img src={settings.logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
                      ) : (
                        <span className="text-3xl">CM</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                      <Button size="sm" variant="outline" loading={logoUploading} onClick={() => logoInputRef.current?.click()}>
                        Upload Logo
                      </Button>
                      {settings.logoUrl ? (
                        <Button size="sm" variant="ghost" className="block text-red-400" onClick={handleRemoveLogo}>
                          Remove Logo
                        </Button>
                      ) : null}
                      <p className="text-xs text-muted-foreground">JPG, PNG, SVG, WEBP, max 2 MB</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Business Name</Label>
                    <Input value={settings.businessName} onChange={(e) => setTop('businessName', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timezone</Label>
                    <Select value={settings.timezone} onChange={(e) => setTop('timezone', e.target.value)}>
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                      <option value="UTC">UTC</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency Code</Label>
                    <Input value={settings.currency} onChange={(e) => setTop('currency', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency Symbol</Label>
                    <Input value={settings.currencySymbol} onChange={(e) => setTop('currencySymbol', e.target.value)} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Tax Percentage (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={settings.taxPercent}
                      onChange={(e) => setTop('taxPercent', Number(e.target.value))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'receipt' ? (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-5">
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Invoice Layout Settings
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Template Name</Label>
                      <Input
                        value={settings.receipt.templateName}
                        onChange={(e) => setReceipt('templateName', e.target.value)}
                        placeholder="The Golden Frame Receipt"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Font Style</Label>
                      <Select value={settings.receipt.fontStyle} onChange={(e) => setReceipt('fontStyle', e.target.value)}>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Courier">Courier</option>
                        <option value="Times-Roman">Times Roman</option>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Section title="Header" defaultOpen>
                <ToggleRow
                  label="Logo"
                  description="Shows the uploaded business logo on the receipt"
                  checked={settings.receipt.header.showLogo}
                  onChange={(value) => setHeader('showLogo', value)}
                />
                <ToggleRow label="Business Name" checked onChange={() => {}}>
                  <div className="space-y-1.5">
                    <Label>Business Name</Label>
                    <Input
                      value={settings.receipt.header.businessName}
                      onChange={(e) => setHeader('businessName', e.target.value)}
                      placeholder={`Leave blank to use "${settings.businessName}"`}
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Address"
                  checked={settings.receipt.header.showAddress}
                  onChange={(value) => setHeader('showAddress', value)}
                >
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Address Line 1</Label>
                      <Input
                        value={settings.receipt.header.addressLine1}
                        onChange={(e) => setHeader('addressLine1', e.target.value)}
                        placeholder="Street / Area"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Address Line 2</Label>
                      <Input
                        value={settings.receipt.header.addressLine2}
                        onChange={(e) => setHeader('addressLine2', e.target.value)}
                        placeholder="City, State, PIN"
                      />
                    </div>
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Phone"
                  checked={settings.receipt.header.showPhone}
                  onChange={(value) => setHeader('showPhone', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={settings.receipt.header.phone} onChange={(e) => setHeader('phone', e.target.value)} />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Email"
                  checked={settings.receipt.header.showEmail}
                  onChange={(value) => setHeader('showEmail', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={settings.receipt.header.email}
                      onChange={(e) => setHeader('email', e.target.value)}
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Website"
                  checked={settings.receipt.header.showWebsite}
                  onChange={(value) => setHeader('showWebsite', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Website URL</Label>
                    <Input value={settings.receipt.header.website} onChange={(e) => setHeader('website', e.target.value)} />
                  </div>
                </ToggleRow>
              </Section>

              <Section title="Order Details">
                <ToggleRow
                  label="Customer Name"
                  checked={settings.receipt.orderDetails.showCustomer}
                  onChange={(value) => setOrderDetails('showCustomer', value)}
                />
                <ToggleRow
                  label="Table Name"
                  checked={settings.receipt.orderDetails.showTableName}
                  onChange={(value) => setOrderDetails('showTableName', value)}
                />
                <ToggleRow
                  label="Duration"
                  checked={settings.receipt.orderDetails.showDuration}
                  onChange={(value) => setOrderDetails('showDuration', value)}
                />
                <ToggleRow
                  label="Staff Name"
                  checked={settings.receipt.orderDetails.showStaffName}
                  onChange={(value) => setOrderDetails('showStaffName', value)}
                />
                <ToggleRow
                  label="Itemized List"
                  checked={settings.receipt.orderDetails.showItemizedList}
                  onChange={(value) => setOrderDetails('showItemizedList', value)}
                />
                <ToggleRow
                  label="Discount"
                  checked={settings.receipt.orderDetails.showDiscount}
                  onChange={(value) => setOrderDetails('showDiscount', value)}
                />
                <ToggleRow
                  label="Tax"
                  checked={settings.receipt.orderDetails.showTax}
                  onChange={(value) => setOrderDetails('showTax', value)}
                />
              </Section>

              <Section title="Footer">
                <ToggleRow
                  label="Thank You Message"
                  checked={settings.receipt.footer.showThankYou}
                  onChange={(value) => setFooter('showThankYou', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Thank You Message</Label>
                    <textarea
                      value={settings.receipt.footer.thankYouMessage}
                      onChange={(e) => setFooter('thankYouMessage', e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Terms & Conditions"
                  checked={settings.receipt.footer.showTerms}
                  onChange={(value) => setFooter('showTerms', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Terms & Conditions Text</Label>
                    <textarea
                      value={settings.receipt.footer.termsText}
                      onChange={(e) => setFooter('termsText', e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Notes"
                  checked={settings.receipt.footer.showNotes}
                  onChange={(value) => setFooter('showNotes', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Notes Text</Label>
                    <textarea
                      value={settings.receipt.footer.notesText}
                      onChange={(e) => setFooter('notesText', e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Payment Instructions"
                  checked={settings.receipt.footer.showPaymentInstructions}
                  onChange={(value) => setFooter('showPaymentInstructions', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Instructions</Label>
                    <textarea
                      value={settings.receipt.footer.paymentInstructions}
                      onChange={(e) => setFooter('paymentInstructions', e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="Bank Details"
                  checked={settings.receipt.footer.showBankDetails}
                  onChange={(value) => setFooter('showBankDetails', value)}
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Bank Name</Label>
                      <Input value={settings.receipt.footer.bankName} onChange={(e) => setFooter('bankName', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Account Number</Label>
                      <Input
                        value={settings.receipt.footer.accountNumber}
                        onChange={(e) => setFooter('accountNumber', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>IFSC Code</Label>
                      <Input value={settings.receipt.footer.ifscCode} onChange={(e) => setFooter('ifscCode', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>UPI ID</Label>
                      <Input value={settings.receipt.footer.upiId} onChange={(e) => setFooter('upiId', e.target.value)} />
                    </div>
                  </div>
                </ToggleRow>
                <ToggleRow
                  label="QR Code"
                  description="Shows a scannable QR code on the receipt"
                  checked={settings.receipt.footer.showQRCode}
                  onChange={(value) => setFooter('showQRCode', value)}
                />
                <ToggleRow
                  label="Signature"
                  description="Shows a signature line at the bottom"
                  checked={settings.receipt.footer.showSignature}
                  onChange={(value) => setFooter('showSignature', value)}
                >
                  <div className="space-y-1.5">
                    <Label>Signature Label</Label>
                    <Input
                      value={settings.receipt.footer.signatureLabel}
                      onChange={(e) => setFooter('signatureLabel', e.target.value)}
                      placeholder="Authorized Signature"
                    />
                  </div>
                </ToggleRow>
              </Section>
            </div>
          ) : null}

          {activeTab === 'system' ? (
            <Card>
              <CardContent className="space-y-5 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">System Configuration</h3>
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4">
                  <div>
                    <p className="text-sm font-medium">Auto Backup</p>
                    <p className="text-xs text-muted-foreground">Automatically backup data daily</p>
                  </div>
                  <Toggle checked={settings.backupEnabled} onChange={(value) => setTop('backupEnabled', value)} />
                </div>
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Daily Business Report</p>
                      <p className="text-xs text-muted-foreground">Send the automated daily report by email</p>
                    </div>
                    <Toggle
                      checked={settings.dailyReportEnabled}
                      onChange={(value) => setTop('dailyReportEnabled', value)}
                    />
                  </div>
                  {settings.dailyReportEnabled ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Sender Email</Label>
                        <Input
                          value={settings.dailyReportFromEmail}
                          onChange={(e) => setTop('dailyReportFromEmail', e.target.value)}
                          placeholder="reports@thegoldenframe.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Client Email</Label>
                        <Input
                          value={settings.dailyReportEmails}
                          onChange={(e) => setTop('dailyReportEmails', e.target.value)}
                          placeholder="client@example.com"
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Branches</Label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {branchesData.map((branch: Branch) => (
                            <label
                              key={branch._id}
                              className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="rounded border-border"
                                checked={settings.dailyReportBranchIds.includes(branch._id)}
                                onChange={(e) => setBranchSelection(branch._id, e.target.checked)}
                              />
                              <span>{branch.name}</span>
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Leave empty to include all active branches.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400">
                  <p className="mb-1 font-semibold">Danger Zone</p>
                  <p className="text-xs text-muted-foreground">
                    Contact your system administrator for database reset or data export operations.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button size="lg" loading={saveMutation.isPending} onClick={handleSave}>
              Save All Settings
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {showPreview ? (
            <motion.div
              initial={{ opacity: 0, x: 30, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 360 }}
              exit={{ opacity: 0, x: 30, width: 0 }}
              className="shrink-0"
            >
              <div className="sticky top-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Updates as you type</span>
                </div>
                <ReceiptPreview settings={settings} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
