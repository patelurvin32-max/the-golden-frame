import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { contactService } from '@/services';
import { useAppStore } from '@/store';
import { useToast } from '@/components/ui';

export default function ContactUsPage() {
  const { selectedBranch } = useAppStore();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const limit = 20;
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['contact-messages', selectedBranch, page, status, search],
    queryFn: () =>
      contactService.getMessages({ page, limit, branch: selectedBranch || undefined, status: status || undefined, search: search || undefined }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const messages = data?.data?.data?.messages || [];
  const pagination = data?.data?.data?.pagination;

  const markStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'new' | 'read' | 'resolved' }) =>
      contactService.updateStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-messages'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Contact Us - Messages</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, phone, email, subject..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full sm:w-64 px-3 py-2 border rounded-lg text-sm bg-background text-foreground border-border"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border rounded-lg text-sm bg-background text-foreground border-border"
        >
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Name</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Phone Number</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Email</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Subject</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Message</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Status</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            ) : messages.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No messages found</td></tr>
            ) : (
              messages.map((msg: any) => (
                <tr key={msg._id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 text-foreground">{msg.name}</td>
                  <td className="px-4 py-3 text-foreground">{msg.phone}</td>
                  <td className="px-4 py-3 text-foreground">{msg.email || '-'}</td>
                  <td className="px-4 py-3 text-foreground">{msg.subject}</td>
                  <td className="px-4 py-3 max-w-xs truncate text-foreground" title={msg.message}>{msg.message}</td>
                  <td className="px-4 py-3">
                    <span className={
                      msg.status === 'new' ? 'text-destructive font-medium' :
                      msg.status === 'read' ? 'text-warning font-medium text-amber-500' :
                      'text-primary font-medium'
                    }>
                      {msg.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {msg.status !== 'resolved' && (
                      <button
                        onClick={() => markStatusMutation.mutate({ id: msg._id, status: msg.status === 'new' ? 'read' : 'resolved' })}
                        disabled={markStatusMutation.isPending}
                        className="text-primary hover:underline text-sm disabled:opacity-50"
                      >
                        Mark as {msg.status === 'new' ? 'Read' : 'Resolved'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {messages.map((msg: any) => (
          <div key={msg._id} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex justify-between items-start">
              <p className="font-semibold text-sm text-foreground">{msg.name}</p>
              <span className={
                msg.status === 'new' ? 'text-xs text-destructive font-medium' :
                msg.status === 'read' ? 'text-xs text-warning font-medium text-amber-500' :
                'text-xs text-primary font-medium'
              }>
                {msg.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{msg.phone} {msg.email ? `- ${msg.email}` : ''}</p>
            <p className="text-sm font-medium text-foreground">{msg.subject}</p>
            <p className="text-sm text-muted-foreground">{msg.message}</p>
            {msg.status !== 'resolved' && (
              <button
                onClick={() => markStatusMutation.mutate({ id: msg._id, status: msg.status === 'new' ? 'read' : 'resolved' })}
                disabled={markStatusMutation.isPending}
                className="w-full mt-2 text-sm border border-border rounded-lg py-2 text-primary disabled:opacity-50"
              >
                Mark as {msg.status === 'new' ? 'Read' : 'Resolved'}
              </button>
            )}
          </div>
        ))}
      </div>

      {pagination && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </span>
          <div className="flex gap-2">
            <button
              disabled={!pagination.hasPrevPage}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-border bg-card text-foreground rounded-lg disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-border bg-card text-foreground rounded-lg disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
