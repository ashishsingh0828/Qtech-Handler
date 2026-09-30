import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { PageHeader, SelectField, StatusPill } from '../ui';
import { ROLES } from '@shared/permissions.ts';

interface Member { id: string; name: string; email: string; role: string; roleLabel: string; isActive: boolean }

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('VALIDATOR');
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: Member[] }>('/api/users') });
  return (
    <div className="page">
      <PageHeader title="Team" subtitle="Who can open the registry" />
      <form className="card mb-4 grid gap-3 md:grid-cols-4" onSubmit={(event) => {
        event.preventDefault();
        api('/api/users', { method: 'POST', body: { name, email, password, role } })
          .then(() => { setName(''); setEmail(''); setPassword(''); queryClient.invalidateQueries({ queryKey: ['users'] }); })
          .catch((err: Error) => setError(err.message));
      }}>
        <input className="field" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="field" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <SelectField value={role} onChange={setRole} placeholder="Role" options={ROLES.map((item) => ({ value: item, label: item }))} />
        <button className="btn btn-primary" type="submit">Add member</button>
        {error ? <p className="text-[13px] text-[#A63A38]">{error}</p> : null}
      </form>
      <div className="space-y-2">
        {(query.data?.users || []).map((member) => (
          <article key={member.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{member.name}</div>
              <div className="truncate text-[13px] text-muted">{member.email}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={member.isActive ? 'emerald' : 'stone'}>{member.roleLabel}</StatusPill>
              <button type="button" className="btn btn-secondary" onClick={() => api(`/api/users/${member.id}`, { method: 'PATCH', body: { isActive: !member.isActive } }).then(() => queryClient.invalidateQueries({ queryKey: ['users'] }))}>
                {member.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
