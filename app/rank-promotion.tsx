import { useState } from 'react';
import { ChevronsUp, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { departmentApi, errorMessage, type StaffMember, type StaffRank } from '@/lib/department-api';
import { WorkspaceError } from '@/lib/workspace-api';

export default function RankPromotion({ member, viewer, onClose, onSuccess, onReload }: {
  member: StaffMember; viewer: StaffRank; onClose: () => void; onSuccess: (rank: StaffRank) => void; onReload: () => void;
}) {
  const [rank, setRank] = useState(member.promotionRanks[0]?.name || '');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const groups = [...new Set(member.promotionRanks.map(option => option.group))];
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving || !rank || conflict) return;
    setSaving(true); setError('');
    try {
      const result = await departmentApi<StaffRank>({ action: 'promoteMember', userId: member.userId, rank, version: member.version, actorVersion: viewer.version });
      onSuccess(result);
    } catch (cause) {
      setError(errorMessage(cause)); setConflict(cause instanceof WorkspaceError && cause.status === 409);
    } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="portal-dialog" onInteractOutside={event => { if (saving) event.preventDefault(); }} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Повысить в звании</DialogTitle><DialogDescription>{member.displayName}. Текущее звание — {member.rank}. Ваше звание — {viewer.rank}.</DialogDescription></DialogHeader>
      <form className="portal-form" onSubmit={save}>
        <label className="field">Новое звание<select aria-label="Новое звание" aria-describedby="rank-promotion-note" required disabled={saving || conflict} value={rank} onChange={event => setRank(event.target.value)}>
          {groups.map(group => <optgroup label={group} key={group}>{member.promotionRanks.filter(option => option.group === group).map(option => <option value={option.name} key={option.name}>{option.name}</option>)}</optgroup>)}
        </select></label>
        <p className="portal-note" id="rank-promotion-note">Можно выбрать звание выше текущего звания сотрудника и ниже вашего. Повышение сохраняется в журнале действий.</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="portal-actions"><button type="button" className="button outline" disabled={saving} onClick={onClose}>Отмена</button>
          {conflict ? <button type="button" className="button primary" onClick={onReload}>Обновить состав</button> : <button type="submit" className="button primary" disabled={saving || !rank}>{saving ? <Loader2 className="spin" size={17}/> : <ChevronsUp size={17}/>}Повысить</button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
