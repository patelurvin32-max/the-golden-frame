import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trophy, Users, Calendar, ArrowLeft, CheckCircle, ChevronRight, X, Download, Settings, RefreshCw, FileText, Clock } from 'lucide-react';
import { tournamentService, branchService, tableService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import { useToast, PageHeader, Spinner as LoadingSpinner, Modal, Input, Label, Button, Select } from '@/components/ui';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- Tournaments List Component ---
function TournamentsList() {
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', maxParticipants: 32, description: '', branch: '', gameCategory: '8-Ball Pool', tournamentDate: '', startTime: '' });
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['tournaments', selectedBranch],
    queryFn: () => tournamentService.getAll(selectedBranch ? { branch: selectedBranch } : undefined).then(r => r.data),
  });

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    enabled: user?.role === 'super_admin',
    staleTime: 5 * 60 * 1000,
  });

  const canSelectBranch = user?.role === 'super_admin';

  const createMutation = useMutation({
    mutationFn: (data: any) => tournamentService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      setIsModalOpen(false);
      toast.success('Tournament created successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create tournament');
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const branchId = canSelectBranch ? formData.branch || selectedBranch : (user?.branches && typeof user.branches[0] === 'string' ? user.branches[0] : (user?.branches?.[0] as any)?._id);
    
    if (!branchId) {
      toast.error('Please select a branch');
      return;
    }
    
    createMutation.mutate({
      ...formData,
      branch: branchId
    });
  };

  if (isLoading) return <LoadingSpinner />;

  const tournaments = data?.data || [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="h-8 w-8 text-yellow-500" />
            Tournaments
          </h1>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Create Tournament
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tournaments.map((tournament: any) => (
          <div 
            key={tournament._id} 
            onClick={() => navigate(`/tournaments/${tournament._id}`)}
            className="bg-card rounded-xl border border-border p-5 hover:border-brand/50 hover:shadow-md hover:shadow-brand/10 transition-all cursor-pointer group"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-semibold group-hover:text-brand transition-colors line-clamp-1">{tournament.name}</h3>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                tournament.status === 'pending' ? 'bg-blue-500/10 text-blue-500' :
                tournament.status === 'ongoing' ? 'bg-orange-500/10 text-orange-500' :
                tournament.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                'bg-gray-500/10 text-gray-500'
              }`}>
                {tournament.status.toUpperCase()}
              </span>
            </div>
            
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span>Max Participants: {tournament.maxParticipants}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Created: {new Date(tournament.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        ))}
        {tournaments.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No tournaments found.</p>
            <Button variant="outline" className="mt-4" onClick={() => setIsModalOpen(true)}>Create the first one</Button>
          </div>
        )}
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Tournament">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Tournament Name</Label>
            <Input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Summer Championship 2026" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Game/Category</Label>
              <Input required value={formData.gameCategory} onChange={(e) => setFormData({ ...formData, gameCategory: e.target.value })} placeholder="e.g. 8-Ball Pool" />
            </div>
            <div>
              <Label>Max Participants</Label>
              <Input type="number" required min={2} max={200} value={formData.maxParticipants} onChange={(e) => setFormData({ ...formData, maxParticipants: parseInt(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date</Label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input type="date" required className="pl-9" value={formData.tournamentDate} onChange={(e) => setFormData({ ...formData, tournamentDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Start Time</Label>
              <div className="relative mt-1">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input type="time" required className="pl-9" value={formData.startTime} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} />
              </div>
            </div>
          </div>
          <div>
            <Label>Description (Optional)</Label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          {canSelectBranch && (
            <div>
              <Label>Branch *</Label>
              <select
                required
                className="flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors mt-1"
                value={formData.branch}
                onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
              >
                <option value="">Select a branch</option>
                {(branchData || []).map((b: any) => (
                  <option key={b._id} value={b._id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Tournament'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// --- Tournament Detail Component ---
function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'participants' | 'bracket' | 'history'>('participants');
  const [isEditOpen, setIsEditOpen] = useState(false);
  
  const { data: tournamentData, isLoading: isLoadingT } = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => tournamentService.getOne(id!).then(r => r.data),
  });
  
  const tournament = tournamentData?.data;

  if (isLoadingT) return <LoadingSpinner />;
  if (!tournament) return <div className="p-8 text-center text-red-500">Tournament not found</div>;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="p-4 sm:p-6 pb-0 border-b border-border bg-card flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate('/tournaments')} className="p-2 hover:bg-accent rounded-lg text-muted-foreground transition-colors flex-shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">{tournament.name}</h1>
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                  tournament.status === 'pending' ? 'bg-blue-500/10 text-blue-500' :
                  tournament.status === 'ongoing' ? 'bg-orange-500/10 text-orange-500' :
                  'bg-green-500/10 text-green-500'
                }`}>
                  {tournament.status.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Round {tournament.currentRound || 0} • Max {tournament.maxParticipants} players</p>
            </div>
          </div>
          {(useAuthStore.getState().user?.role === 'super_admin' || useAuthStore.getState().user?.role === 'branch_admin') && (
            <div className="w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)} className="gap-2 w-full sm:w-auto">
                <Settings className="h-4 w-4" /> Edit Settings
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-6 mt-6">
          <button
            onClick={() => setActiveTab('participants')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'participants' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Participants
          </button>
          <button
            onClick={() => setActiveTab('bracket')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'bracket' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Tournament Bracket
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Match History
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 bg-background">
        {activeTab === 'participants' && <ParticipantsTab tournament={tournament} />}
        {activeTab === 'bracket' && <BracketTab tournament={tournament} />}
        {activeTab === 'history' && <HistoryTab tournament={tournament} />}
      </div>
      
      <EditTournamentModal 
        isOpen={isEditOpen} 
        onClose={() => setIsEditOpen(false)} 
        tournament={tournament} 
      />
    </div>
  );
}

// --- Edit Tournament Modal ---
function EditTournamentModal({ isOpen, onClose, tournament }: { isOpen: boolean, onClose: () => void, tournament: any }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: tournament.name || '',
    gameCategory: tournament.gameCategory || '',
    maxParticipants: tournament.maxParticipants || 32,
    tournamentDate: tournament.tournamentDate ? new Date(tournament.tournamentDate).toISOString().split('T')[0] : '',
    startTime: tournament.startTime || '',
    description: tournament.description || ''
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => tournamentService.update(tournament._id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', tournament._id] });
      toast.success('Tournament updated successfully');
      onClose();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Error updating tournament')
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Edit Tournament Settings">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Tournament Name</Label>
          <Input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Game/Category</Label>
            <Input required value={formData.gameCategory} onChange={(e) => setFormData({ ...formData, gameCategory: e.target.value })} />
          </div>
          <div>
            <Label>Max Participants</Label>
            <Input type="number" required min={2} max={200} value={formData.maxParticipants} onChange={(e) => setFormData({ ...formData, maxParticipants: parseInt(e.target.value) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date</Label>
            <div className="relative mt-1">
              <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input type="date" required className="pl-9" value={formData.tournamentDate} onChange={(e) => setFormData({ ...formData, tournamentDate: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Start Time</Label>
            <div className="relative mt-1">
              <Clock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input type="time" required className="pl-9" value={formData.startTime} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} />
            </div>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
        </div>
        {tournament.status !== 'pending' && formData.maxParticipants !== tournament.maxParticipants && (
          <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg text-sm text-amber-600 mt-2">
            <strong>Warning:</strong> The bracket is already generated. If you change the Max Participants, you must <strong>Regenerate the Bracket</strong> from the Participants Tab.
          </div>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Participants Tab ---
function ParticipantsTab({ tournament }: { tournament: any }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  
  const { data, isLoading } = useQuery({
    queryKey: ['tournament-participants', tournament._id],
    queryFn: () => tournamentService.getParticipants(tournament._id).then(r => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: (forceRegenerate: boolean = false) => tournamentService.generateBracket(tournament._id, forceRegenerate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', tournament._id] });
      queryClient.invalidateQueries({ queryKey: ['tournament-bracket', tournament._id] });
      setIsRegenerateOpen(false);
      toast.success('Bracket generated successfully!');
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Error generating bracket')
  });

  // Mock a customer selector for now, in a real app use an async select or search
  const registerMutation = useMutation({
    mutationFn: (cid: string) => tournamentService.registerParticipant(tournament._id, cid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament-participants', tournament._id] });
      setIsRegisterOpen(false);
      setCustomerId('');
      toast.success('Participant registered');
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Error registering participant')
  });

  const participants = data?.data || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card p-5 rounded-xl border border-border shadow-sm">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-brand" /> Registered Players ({participants.length}/{tournament.maxParticipants})
          </h3>
          {tournament.status === 'pending' && (
            <p className="text-sm text-muted-foreground mt-1">Register players before generating the bracket.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 w-full sm:w-auto">
          {tournament.status === 'pending' ? (
            <>
              <Button variant="outline" onClick={() => setIsRegisterOpen(true)} disabled={participants.length >= tournament.maxParticipants}>
                Add Player
              </Button>
              <Button 
                onClick={() => generateMutation.mutate(false)} 
                disabled={participants.length < 2 || generateMutation.isPending}
                className="bg-brand text-white hover:bg-brand/90"
              >
                {generateMutation.isPending ? 'Generating...' : 'Generate Bracket'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsRegisterOpen(true)} disabled={participants.length >= tournament.maxParticipants}>
                Add Player
              </Button>
              <Button 
                onClick={() => setIsRegenerateOpen(true)} 
                disabled={participants.length < 2 || generateMutation.isPending}
                variant="outline"
                className="border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
              >
                <RefreshCw className="h-4 w-4 mr-2" /> Regenerate Bracket
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? <LoadingSpinner /> : participants.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No players registered yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {participants.map((p: any) => (
              <div key={p._id} className="flex items-center justify-between p-4 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center font-bold text-muted-foreground">
                    #{p.seed}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{p.customer?.name} <span className="text-muted-foreground font-normal text-sm">({p.customer?.customerId})</span></p>
                    <p className="text-xs text-muted-foreground">{p.customer?.phone} • Registered: {new Date(p.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                    p.status === 'active' ? 'bg-green-500/10 text-green-500' :
                    p.status === 'winner' ? 'bg-yellow-500/10 text-yellow-500 font-bold' :
                    'bg-red-500/10 text-red-500 opacity-60'
                  }`}>
                    {p.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={isRegisterOpen} onClose={() => setIsRegisterOpen(false)} title="Register Player">
        <div className="space-y-4">
          <div>
            <Label>Customer ID</Label>
            <Input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="Paste customer ID here..."
            />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setIsRegisterOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => registerMutation.mutate(customerId)} 
              disabled={!customerId || registerMutation.isPending}
            >
              {registerMutation.isPending ? 'Registering...' : 'Register'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={isRegenerateOpen} onClose={() => setIsRegenerateOpen(false)} title="Regenerate Bracket">
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-red-600">
            <h4 className="font-bold flex items-center gap-2 mb-2"><X className="h-5 w-5"/> Destructive Action</h4>
            <p className="text-sm">Regenerating the bracket will <strong>delete all existing match data</strong> for this tournament and reshuffle all players. You should only do this if you need to correct a severe issue or if you just added players after the bracket was initially created.</p>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setIsRegenerateOpen(false)}>Cancel</Button>
            <Button 
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => generateMutation.mutate(true)} 
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? 'Regenerating...' : 'Yes, Regenerate Bracket'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// --- Bracket Tab ---
function BracketTab({ tournament }: { tournament: any }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  
  // Fetch tables for the branch
  const { data: tableData } = useQuery({
    queryKey: ['tables', tournament.branch._id || tournament.branch],
    queryFn: () => tableService.getAll({ branch: tournament.branch._id || tournament.branch }).then(r => r.data.data.tables)
  });

  const [matchForm, setMatchForm] = useState({
    winnerId: '',
    table: '',
    startTime: '',
    endTime: '',
    duration: '',
    notes: ''
  });

  const openMatchUpdate = (match: any) => {
    setSelectedMatch(match);
    setMatchForm({
      winnerId: match.winner?._id || '',
      table: match.table?._id || match.table || '',
      startTime: match.startTime ? new Date(match.startTime).toISOString().slice(0, 16) : '',
      endTime: match.endTime ? new Date(match.endTime).toISOString().slice(0, 16) : '',
      duration: match.duration || '',
      notes: match.notes || ''
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['tournament-bracket', tournament._id],
    queryFn: () => tournamentService.getBracket(tournament._id).then(r => r.data),
    enabled: tournament.status !== 'pending'
  });

  const updateMatchMutation = useMutation({
    mutationFn: (payload: any) => tournamentService.updateMatchResult(payload.matchId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament-bracket', tournament._id] });
      queryClient.invalidateQueries({ queryKey: ['tournament', tournament._id] });
      setSelectedMatch(null);
      toast.success('Match updated successfully');
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Error updating match')
  });

  if (tournament.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-4">
        <Trophy className="h-16 w-16 text-muted-foreground opacity-20" />
        <h2 className="text-xl font-semibold">Bracket Not Generated</h2>
        <p className="text-muted-foreground">Register all your players in the Participants tab and generate the bracket to start the tournament.</p>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner />;

  const matches = data?.data || [];
  
  // Group matches by round
  const rounds = Array.from(new Set(matches.map((m: any) => m.round))).sort((a: any, b: any) => a - b);
  const groupedMatches: Record<number, any[]> = {};
  rounds.forEach((r: any) => {
    groupedMatches[r] = matches.filter((m: any) => m.round === r);
  });

  return (
    <div className="w-full h-full overflow-auto custom-scrollbar">
      <div className="min-w-max p-4 sm:p-8 pt-16 inline-flex items-stretch gap-8 sm:gap-12 select-none">
        {rounds.map((round: any, index: number) => {
          const isFinal = index === rounds.length - 1;
          const matchCol = groupedMatches[round];
          
          return (
            <div key={round} className="flex flex-col justify-around gap-6 relative w-64">
              <h3 className="absolute -top-10 left-0 w-full text-center font-bold text-muted-foreground tracking-wider uppercase text-sm">
                {isFinal ? 'Final' : index === rounds.length - 2 ? 'Semi-Final' : `Round ${round}`}
              </h3>
              
              {matchCol.map((match: any, mIndex: number) => {
                const p1 = match.player1;
                const p2 = match.player2;
                
                return (
                  <div key={match._id} className="relative flex items-center">
                    <div 
                      onClick={() => match.status !== 'completed' && p1 && p2 ? openMatchUpdate(match) : null}
                      className={`w-full bg-card border rounded-lg overflow-hidden flex flex-col shadow-sm transition-all
                        ${match.status !== 'completed' && p1 && p2 ? 'cursor-pointer hover:border-brand/50 hover:shadow-brand/20' : 'border-border'}
                        ${match.status === 'completed' ? 'border-border opacity-90' : ''}
                      `}
                    >
                      {/* Player 1 */}
                      <div className={`p-2.5 flex items-center justify-between border-b border-border ${match.winner?._id === p1?._id ? 'bg-green-500/10' : ''}`}>
                        <div className="flex items-center gap-2 truncate">
                          {p1 ? (
                            <>
                              <span className="text-xs font-mono text-muted-foreground">#{p1.seed}</span>
                              <span className={`text-sm font-medium truncate ${match.winner?._id === p1?._id ? 'text-green-500 font-bold' : ''}`}>
                                {p1.customer?.name}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">TBD</span>
                          )}
                        </div>
                        {match.winner?._id === p1?._id && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                      </div>
                      
                      {/* Player 2 */}
                      <div className={`p-2.5 flex items-center justify-between ${match.winner?._id === p2?._id ? 'bg-green-500/10' : ''}`}>
                        <div className="flex items-center gap-2 truncate">
                          {p2 ? (
                            <>
                              <span className="text-xs font-mono text-muted-foreground">#{p2.seed}</span>
                              <span className={`text-sm font-medium truncate ${match.winner?._id === p2?._id ? 'text-green-500 font-bold' : ''}`}>
                                {p2.customer?.name}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">TBD</span>
                          )}
                        </div>
                        {match.winner?._id === p2?._id && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                      </div>
                      
                      {/* Admin Update Button for completed matches */}
                      {match.status === 'completed' && match.player1 && match.player2 && (
                         <button onClick={(e) => { e.stopPropagation(); openMatchUpdate(match); }} className="w-full bg-muted/50 hover:bg-accent text-center text-[10px] py-1 uppercase tracking-widest text-muted-foreground transition-colors border-t border-border">
                           Update Match
                         </button>
                      )}
                      
                      {match.status === 'completed' && !match.player2 && match.player1 && (
                         <div className="bg-muted text-center text-[10px] py-0.5 uppercase tracking-widest text-muted-foreground border-t border-border">BYE</div>
                      )}
                    </div>

                    {/* Connecting Lines to Next Round */}
                    {!isFinal && (
                      <div className="absolute left-full w-6 flex items-center">
                        <div className={`h-px w-full ${match.winner ? 'bg-brand' : 'bg-border'}`}></div>
                        {mIndex % 2 === 0 ? (
                          <div className={`absolute left-full w-6 border-t border-r rounded-tr-lg ${match.winner ? 'border-brand' : 'border-border'}`} style={{ height: 'calc(50% + 12px)', top: '50%' }}></div>
                        ) : (
                          <div className={`absolute left-full w-6 border-b border-r rounded-br-lg ${match.winner ? 'border-brand' : 'border-border'}`} style={{ height: 'calc(50% + 12px)', bottom: '50%' }}></div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        
        {/* Winner Display */}
        {tournament.status === 'completed' && groupedMatches[rounds[rounds.length - 1] as number]?.[0]?.winner && (
          <div className="flex flex-col justify-center gap-6 relative w-48 pl-8 border-l-2 border-brand/50 border-dashed ml-4">
             <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/50 rounded-xl p-6 text-center shadow-lg shadow-yellow-500/10">
                <Trophy className="h-12 w-12 text-yellow-500 mx-auto mb-3 drop-shadow-md" />
                <p className="text-sm font-medium text-yellow-600/80 uppercase tracking-widest mb-1">Champion</p>
                <h3 className="text-xl font-bold text-foreground truncate">
                  {groupedMatches[rounds[rounds.length - 1] as number][0].winner.customer?.name}
                </h3>
             </div>
          </div>
        )}
      </div>

      <Modal open={!!selectedMatch} onClose={() => setSelectedMatch(null)} title={`Match Settings: Round ${selectedMatch?.round}`}>
        {selectedMatch && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Table Used</Label>
                <select
                  className="flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors mt-1"
                  value={matchForm.table}
                  onChange={(e) => setMatchForm({ ...matchForm, table: e.target.value })}
                >
                  <option value="">Select Table</option>
                  {(tableData || []).map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Winner</Label>
                <select
                  required
                  className="flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors mt-1"
                  value={matchForm.winnerId}
                  onChange={(e) => setMatchForm({ ...matchForm, winnerId: e.target.value })}
                >
                  <option value="">Select Winner</option>
                  {selectedMatch.player1 && <option value={selectedMatch.player1._id}>{selectedMatch.player1.customer?.name}</option>}
                  {selectedMatch.player2 && <option value={selectedMatch.player2._id}>{selectedMatch.player2.customer?.name}</option>}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Time</Label>
                <Input type="datetime-local" value={matchForm.startTime} onChange={(e) => setMatchForm({ ...matchForm, startTime: e.target.value })} />
              </div>
              <div>
                <Label>End Time</Label>
                <Input type="datetime-local" value={matchForm.endTime} onChange={(e) => setMatchForm({ ...matchForm, endTime: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Duration (mins)</Label>
                <Input type="text" placeholder="e.g. 45" value={matchForm.duration} onChange={(e) => setMatchForm({ ...matchForm, duration: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={matchForm.notes} onChange={(e) => setMatchForm({ ...matchForm, notes: e.target.value })} />
            </div>
            {selectedMatch.status === 'completed' && matchForm.winnerId && matchForm.winnerId !== selectedMatch.winner?._id && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg text-sm text-amber-600 mt-2">
                <strong>Warning:</strong> You are changing the winner of a completed match. This will remove the previous winner from downstream matches. Ensure subsequent matches haven't started.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setSelectedMatch(null)}>Cancel</Button>
              <Button 
                onClick={() => updateMatchMutation.mutate({ matchId: selectedMatch._id, ...matchForm })}
                disabled={updateMatchMutation.isPending || !matchForm.winnerId}
              >
                {updateMatchMutation.isPending ? 'Saving...' : 'Save Match Data'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- History Tab ---
function HistoryTab({ tournament }: { tournament: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tournament-bracket', tournament._id],
    queryFn: () => tournamentService.getBracket(tournament._id).then(r => r.data),
    enabled: tournament.status !== 'pending'
  });

  if (tournament.status === 'pending') {
    return <div className="p-8 text-center text-muted-foreground">Bracket not generated yet.</div>;
  }

  if (isLoading) return <LoadingSpinner />;

  const matches = data?.data || [];

  const handleExport = () => {
    const exportData = matches.map((m: any) => ({
      'Tournament Name': tournament.name,
      'Date': tournament.tournamentDate ? new Date(tournament.tournamentDate).toLocaleDateString() : '',
      'Branch': tournament.branch?.name || '',
      'Round': m.round,
      'Match Number': m.matchNumber,
      'Player 1': m.player1?.customer?.name || (m.player2 ? 'BYE' : 'TBD'),
      'Player 2': m.player2?.customer?.name || (m.player1 ? 'BYE' : 'TBD'),
      'Table': m.table?.name || 'N/A',
      'Start Time': m.startTime ? new Date(m.startTime).toLocaleString() : 'N/A',
      'End Time': m.endTime ? new Date(m.endTime).toLocaleString() : 'N/A',
      'Duration': m.duration || 'N/A',
      'Winner': m.winner?.customer?.name || 'TBD',
      'Loser': m.loser?.customer?.name || (m.status === 'completed' ? 'BYE' : 'TBD'),
      'Status': m.status.toUpperCase(),
      'Notes': m.notes || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tournament History');
    XLSX.writeFile(workbook, `${tournament.name.replace(/\s+/g, '_')}_Matches.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.text(`Tournament Schedule: ${tournament.name}`, 14, 15);
    
    const tableColumn = ["Round", "Match", "Player 1", "Player 2", "Table", "Time", "Winner"];
    const tableRows: any[] = [];

    matches.forEach((m: any) => {
      const rowData = [
        `Round ${m.round}`,
        `M${m.matchNumber}`,
        m.player1?.customer?.name || (m.player2 ? 'BYE' : 'TBD'),
        m.player2?.customer?.name || (m.player1 ? 'BYE' : 'TBD'),
        m.table?.name || 'N/A',
        m.startTime ? new Date(m.startTime).toLocaleString([], {hour: '2-digit', minute:'2-digit', month: 'short', day: 'numeric'}) : 'N/A',
        m.winner?.customer?.name || 'TBD'
      ];
      tableRows.push(rowData);
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      styles: { fontSize: 8 },
    });

    doc.save(`${tournament.name.replace(/\s+/g, '_')}_Schedule.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card p-5 rounded-xl border border-border shadow-sm">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          Match History
        </h3>
        <div className="flex gap-3">
          <Button onClick={handleExportPDF} variant="outline" className="gap-2">
            <FileText className="h-4 w-4 text-red-500" /> Export PDF
          </Button>
          <Button onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 border-b border-border uppercase text-xs text-muted-foreground tracking-wider">
            <tr>
              <th className="px-4 py-3">Round</th>
              <th className="px-4 py-3">Match</th>
              <th className="px-4 py-3">Player 1</th>
              <th className="px-4 py-3">Player 2</th>
              <th className="px-4 py-3">Winner</th>
              <th className="px-4 py-3">Table</th>
              <th className="px-4 py-3">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {matches.map((m: any) => (
              <tr key={m._id} className="hover:bg-accent/50 transition-colors">
                <td className="px-4 py-3 font-medium">Round {m.round}</td>
                <td className="px-4 py-3">M{m.matchNumber}</td>
                <td className="px-4 py-3">{m.player1?.customer?.name || (m.player2 ? 'BYE' : 'TBD')}</td>
                <td className="px-4 py-3">{m.player2?.customer?.name || (m.player1 ? 'BYE' : 'TBD')}</td>
                <td className="px-4 py-3 font-bold text-brand">{m.winner?.customer?.name || '-'}</td>
                <td className="px-4 py-3">{m.table?.name || '-'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {m.startTime ? new Date(m.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TournamentsPage() {
  return (
    <Routes>
      <Route index element={<TournamentsList />} />
      <Route path=":id" element={<TournamentDetail />} />
    </Routes>
  );
}
