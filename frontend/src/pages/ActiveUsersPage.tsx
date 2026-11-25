import { useState } from 'react';
import { Search } from 'lucide-react';
import { Select } from '@/components/ui';

export default function ActiveUsersPage() {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Mock data for UI demonstration
  const mockUsers = Array.from({ length: rowsPerPage }).map((_, index) => ({
    _id: `id_${index + 1}`,
    customerId: `CUST-00${index + 1}`,
    name: `Test User ${index + 1}`,
    mobile: `+1 555 123 45${index.toString().padStart(2, '0')}`,
    email: `user${index + 1}@example.com`
  }));

  // Mock pagination for UI demonstration
  const pagination = {
    page: page,
    pages: 5,
    total: 42,
    hasPrevPage: page > 1,
    hasNextPage: page < 5,
  };

  const handleSearch = () => {
    // To be implemented: trigger data fetch with filters
    setPage(1);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Active Users</h1>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-card p-4 rounded-lg border border-border">
        <div className="w-full sm:flex-1">
          <input
            type="search"
            placeholder="Search by ID, name, or mobile..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm bg-background text-foreground border-border focus:ring-1 focus:ring-primary outline-none transition-all"
          />
        </div>
        <div className="flex items-center justify-between w-full sm:w-auto gap-3">
          <button
            onClick={handleSearch}
            className="flex-1 sm:flex-none justify-center px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 h-[38px]"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span>Search</span>
          </button>
  
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Rows:</span>
            <Select
              value={String(rowsPerPage)}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
              className="w-20 bg-background"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Customer ID</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Name</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Mobile Number</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Email</th>
              <th className="px-4 py-3 text-left whitespace-nowrap text-muted-foreground font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {mockUsers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No active users found</td></tr>
            ) : (
              mockUsers.map((user) => (
                <tr key={user._id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{user.customerId}</td>
                  <td className="px-4 py-3 text-foreground">{user.name}</td>
                  <td className="px-4 py-3 text-foreground">{user.mobile}</td>
                  <td className="px-4 py-3 text-foreground">{user.email || '-'}</td>
                  <td className="px-4 py-3">
                    {/* Action buttons reserved for future functionality */}
                    <button className="text-primary hover:underline text-sm font-medium opacity-50 cursor-not-allowed">
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {mockUsers.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground border border-border rounded-lg bg-card">
            No active users found
          </div>
        ) : (
          mockUsers.map((user) => (
            <div key={user._id} className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex justify-between items-start">
                <p className="font-semibold text-sm text-foreground">{user.name}</p>
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {user.customerId}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">📞 {user.mobile}</p>
              {user.email && <p className="text-xs text-muted-foreground">✉️ {user.email}</p>}
              <div className="pt-2 mt-2 border-t border-border flex justify-end">
                <button className="text-primary hover:underline text-xs font-medium opacity-50 cursor-not-allowed">
                  Manage User
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination UI */}
      {pagination && (
        <div className="flex flex-col sm:flex-row items-center justify-between text-sm gap-4 bg-card p-4 rounded-lg border border-border">
          <span className="text-muted-foreground font-medium">
            Page {pagination.page} of {pagination.pages} <span className="mx-1">•</span> {pagination.total} total records
          </span>
          <div className="flex gap-2">
            <button
              disabled={!pagination.hasPrevPage}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 border border-border bg-background text-foreground rounded-lg disabled:opacity-40 hover:bg-muted transition-colors font-medium"
            >
              Previous
            </button>
            <div className="hidden sm:flex gap-1 items-center">
               {/* Display a few page numbers - simplified for UI */}
               {[1, 2, 3].map(pageNum => (
                 <button
                   key={pageNum}
                   onClick={() => setPage(pageNum)}
                   className={`w-8 h-8 rounded-lg flex items-center justify-center font-medium ${page === pageNum ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'}`}
                 >
                   {pageNum}
                 </button>
               ))}
               {pagination.pages > 3 && <span className="px-1 text-muted-foreground">...</span>}
            </div>
            <button
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 border border-border bg-background text-foreground rounded-lg disabled:opacity-40 hover:bg-muted transition-colors font-medium"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
