"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent
} from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import { inviteUser, updateUserName, updateUserRole } from "./actions";
import type { Role } from "@/lib/supabase/types";

export type UserRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  confirmed: boolean;
  role: Role;
  full_name: string | null;
  phone: string | null;
};

export function UsersClient({
  initial,
  currentUserId
}: {
  initial: UserRow[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState<UserRow[]>(initial);
  const [inviting, setInviting] = useState(false);

  const counts = useMemo(() => {
    let admins = 0,
      techs = 0,
      pending = 0;
    for (const u of users) {
      if (u.role === "admin") admins++;
      else techs++;
      if (!u.last_sign_in_at) pending++;
    }
    return { admins, techs, pending };
  }, [users]);

  const onRoleChanged = useCallback((id: string, role: Role) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }, []);

  const onNameChanged = useCallback((id: string, full_name: string | null) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, full_name } : u)));
  }, []);

  const onUserInvited = useCallback((email: string, role: Role) => {
    // Optimistic: prepend a placeholder until the page refetches on next nav.
    setUsers((prev) => [
      {
        id: `pending-${email}`,
        email,
        created_at: new Date().toISOString(),
        last_sign_in_at: null,
        invited_at: new Date().toISOString(),
        confirmed: false,
        role,
        full_name: null,
        phone: null
      },
      ...prev
    ]);
  }, []);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <Header counts={counts} total={users.length} />

        <div className="mt-8">
          {inviting ? (
            <InviteForm
              onCancel={() => setInviting(false)}
              onInvited={(email, role) => {
                onUserInvited(email, role);
                setInviting(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="inline-flex items-center gap-2 border border-dashed border-border bg-background px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Invite a new user
            </button>
          )}
        </div>

        <ul className="mt-8 divide-y divide-border border border-border bg-card">
          {users.length === 0 ? (
            <li className="px-6 py-10 text-center text-sm text-muted-foreground">
              No users yet. Invite someone to get started.
            </li>
          ) : (
            users.map((u, i) => (
              <UserRowEditor
                key={u.id}
                user={u}
                isSelf={u.id === currentUserId}
                index={i}
                onRoleChanged={(role) => onRoleChanged(u.id, role)}
                onNameChanged={(name) => onNameChanged(u.id, name)}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function Header({
  counts,
  total
}: {
  counts: { admins: number; techs: number; pending: number };
  total: number;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Access · Roles
      </p>
      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        Team.
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        {total === 0
          ? "No users on the system."
          : `${total} on the system · ${counts.admins} admin${counts.admins === 1 ? "" : "s"} · ${counts.techs} technician${counts.techs === 1 ? "" : "s"}${
              counts.pending > 0 ? ` · ${counts.pending} pending` : ""
            }.`}
      </p>
    </header>
  );
}

function UserRowEditor({
  user,
  isSelf,
  index,
  onRoleChanged,
  onNameChanged
}: {
  user: UserRow;
  isSelf: boolean;
  index: number;
  onRoleChanged: (role: Role) => void;
  onNameChanged: (name: string | null) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.full_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pending, startTransition] = useTransition();
  const isPending = user.id.startsWith("pending-");

  const onRoleSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Role;
    if (next === user.role) return;
    setError(null);
    startTransition(async () => {
      const result = await updateUserRole(user.id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onRoleChanged(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    });
  };

  const saveName = () => {
    const next = nameDraft.trim();
    setError(null);
    startTransition(async () => {
      const result = await updateUserName(user.id, next === "" ? null : next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onNameChanged(next === "" ? null : next);
      setEditingName(false);
    });
  };

  const cancelEdit = () => {
    setEditingName(false);
    setNameDraft(user.full_name ?? "");
  };

  const initial = (user.full_name?.[0] || user.email?.[0] || "?").toUpperCase();

  return (
    <li
      className="grid gap-3 px-4 py-4 animate-card-in md:grid-cols-[48px_1fr_auto_auto] md:items-center md:gap-6 md:px-6"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Avatar */}
      <div
        aria-hidden="true"
        className={cn(
          "flex h-10 w-10 items-center justify-center font-mono text-sm font-medium",
          user.role === "admin"
            ? "bg-primary/15 text-primary"
            : "bg-secondary text-foreground"
        )}
      >
        {initial}
      </div>

      {/* Identity */}
      <div className="min-w-0">
        {editingName ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoFocus
              placeholder="Full name"
              className="border border-border bg-background px-3 py-1.5 text-[14px] text-foreground focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={pending}
              className="inline-flex items-center gap-1 border border-border bg-background px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {user.full_name ? (
              <span className="font-serif text-[18px] leading-tight text-ink">{user.full_name}</span>
            ) : (
              <span className="font-mono text-[13px] uppercase tracking-[0.1em] text-muted-foreground">
                No name set
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setNameDraft(user.full_name ?? "");
                setEditingName(true);
              }}
              aria-label="Edit name"
              className="text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
          <span className="font-mono">{user.email ?? "—"}</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono uppercase tracking-[0.12em]">
            {user.last_sign_in_at ? (
              <RelativeTime iso={user.last_sign_in_at} prefix="Last in " />
            ) : (
              "Pending first sign-in"
            )}
          </span>
          {isSelf && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary/80">
                You
              </span>
            </>
          )}
          {isPending && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-urgency-normal">
                <Mail className="h-3 w-3" />
                Invite sent
              </span>
            </>
          )}
        </p>

        {error && (
          <p className="mt-1.5 font-mono text-[11px] text-destructive">{error}</p>
        )}
      </div>

      {/* Role dropdown */}
      <RoleSelect
        value={user.role}
        disabled={isPending || pending || isSelf}
        savedFlash={savedFlash}
        onChange={onRoleSelect}
      />

      {/* Spacer / future actions */}
      <div className="hidden md:block w-2" />
    </li>
  );
}

function RoleSelect({
  value,
  disabled,
  savedFlash,
  onChange
}: {
  value: Role;
  disabled: boolean;
  savedFlash: boolean;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const isAdmin = value === "admin";
  return (
    <label
      className={cn(
        "group relative inline-flex items-center gap-2 border bg-background px-3 py-1.5 text-[12px] transition-colors",
        isAdmin ? "border-primary/40" : "border-border",
        "focus-within:border-primary focus-within:ring-1 focus-within:ring-primary",
        disabled && "cursor-not-allowed opacity-60",
        savedFlash && "border-primary"
      )}
    >
      {isAdmin ? (
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      ) : (
        <UserPlus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="sr-only">Role</span>
      <span className={cn("tabular-nums", isAdmin ? "text-primary" : "text-foreground")}>
        {isAdmin ? "Admin" : "Technician"}
      </span>
      <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        <option value="technician">Technician</option>
        <option value="admin">Admin</option>
      </select>
    </label>
  );
}

function InviteForm({
  onCancel,
  onInvited
}: {
  onCancel: () => void;
  onInvited: (email: string, role: Role) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await inviteUser({ email, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onInvited(email.trim().toLowerCase(), role);
    });
  };

  return (
    <form onSubmit={submit} className="border border-border bg-card p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            New user
          </p>
          <h3 className="mt-2 font-serif text-2xl text-ink">Invite a teammate.</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            They&apos;ll receive an email with a magic link to set their password.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close invite form"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@acmepest.com"
            className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:border-primary focus:outline-none"
          >
            <option value="technician">Technician</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending || email.trim() === ""}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground transition-colors",
            "hover:border-primary hover:bg-primary hover:text-primary-foreground",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Send invite
        </button>
      </div>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>
      )}
    </form>
  );
}
