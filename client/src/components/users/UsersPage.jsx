import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { hasPermission, ROLES } from '@shared/permissions.js';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Field } from '../ui';

const EMPTY = { name: '', email: '', password: '', role: 'service' };

export default function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  function load() {
    return api('/api/users').then((data) => setUsers(data.users)).catch((err) => toast(err.message));
  }

  useEffect(() => {
    if (hasPermission(user?.role, 'manageUsers')) load();
  }, [user]);

  if (!hasPermission(user?.role, 'manageUsers')) {
    return <Navigate to="/" replace />;
  }

  async function createUser(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/users', { method: 'POST', body: form });
      setForm(EMPTY);
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(record, patch) {
    try {
      await api(`/api/users/${record.id}`, { method: 'PATCH', body: patch });
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1120px] px-8 py-10">
        <h1 className="font-serif text-[40px] leading-none">Directory</h1>
        <p className="mt-3 text-muted">Create accounts and retire access. Roles are enforced on every write.</p>

        <form onSubmit={createUser} className="card mt-8 grid gap-4 p-5 md:grid-cols-5">
          <Field label="Name">
            <input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <Field label="Email">
            <input className="field" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </Field>
          <Field label="Password">
            <input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={8} />
          </Field>
          <Field label="Role">
            <select className="field" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" type="submit" disabled={busy}>Create user</button>
          </div>
        </form>

        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface2 text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((record) => (
                <tr key={record.id} className="border-t border-hairline">
                  <td className="px-4 py-3">{record.name}</td>
                  <td className="px-4 py-3 text-ink2">{record.email}</td>
                  <td className="px-4 py-3">
                    <select className="field" value={record.role} onChange={(event) => updateUser(record, { role: event.target.value })}>
                      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">{record.active ? 'Active' : 'Inactive'}</td>
                  <td className="px-4 py-3 text-right">
                    {record.active ? (
                      <button type="button" className="btn btn-secondary" onClick={() => updateUser(record, { active: false })}>Deactivate</button>
                    ) : (
                      <button type="button" className="btn btn-secondary" onClick={() => updateUser(record, { active: true })}>Restore</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
