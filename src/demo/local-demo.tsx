"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Role = "system_admin" | "team_admin" | "user";
type View =
  | "dashboard"
  | "crosses"
  | "phenotypes"
  | "inventory"
  | "calendar"
  | "import"
  | "team";
type Cross = {
  code: string;
  female: string;
  male: string;
  seeds: number;
  units: number;
  status: string;
};
type Score = { code: string; vigor: number; yield: number; stability: number };
type Stock = {
  name: string;
  lot: string;
  quantity: number;
  minimum: number;
  expires: string;
};
type Task = { title: string; due: string; status: string; owner: string };
type User = { name: string; email: string; role: Role };

const initial = {
  crosses: [
    {
      code: "DEMO-X-001",
      female: "DEMO-F-01",
      male: "DEMO-M-01",
      seeds: 480,
      units: 10,
      status: "Actif",
    },
  ],
  scores: [{ code: "DEMO-PHENO-001", vigor: 9, yield: 9, stability: 9 }],
  stock: [
    {
      name: "Gants nitrile",
      lot: "LOT-DEMO-01",
      quantity: 8,
      minimum: 3,
      expires: "2026-11-06",
    },
  ],
  tasks: [
    {
      title: "Évaluer la germination",
      due: "2026-09-06",
      status: "En cours",
      owner: "Marie Martin",
    },
  ],
  users: [
    {
      name: "Administrateur",
      email: "admin@breedops.demo",
      role: "system_admin" as Role,
    },
    {
      name: "Marie Martin",
      email: "marie@breedops.demo",
      role: "team_admin" as Role,
    },
    { name: "Alex Dupont", email: "alex@breedops.demo", role: "user" as Role },
  ],
};
const labels: Record<View, string> = {
  dashboard: "Tableau de bord",
  crosses: "Croisements et lots",
  phenotypes: "Notation phénotypique",
  inventory: "Inventaire",
  calendar: "Calendrier et Gantt",
  import: "Import et export",
  team: "Équipe et rôles",
};
const roleLabel = (role: Role) =>
  ({
    system_admin: "Administrateur application",
    team_admin: "Administrateur équipe",
    user: "Utilisateur",
  })[role];
const weighted = (score: Score) =>
  score.vigor + score.yield * 2 + score.stability * 4;
const selection = (score: Score) =>
  weighted(score) >= 110 && score.stability >= 9
    ? "Élite"
    : weighted(score) >= 100 && score.stability >= 8
      ? "Avancer"
      : weighted(score) >= 90 && score.stability >= 7
        ? "Réserve"
        : "Éliminer";
function download(name: string, rows: Record<string, string | number>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const csv = [
    keys.join(","),
    ...rows.map((row) =>
      keys.map((key) => JSON.stringify(row[key] ?? "")).join(","),
    ),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  link.download = name + ".csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function HomePage() {
  const [session, setSession] = useState<{ name: string; role: Role } | null>(
    null,
  );
  const [view, setView] = useState<View>("dashboard");
  const [crosses, setCrosses] = useState<Cross[]>(initial.crosses);
  const [scores, setScores] = useState<Score[]>(initial.scores);
  const [stock, setStock] = useState<Stock[]>(initial.stock);
  const [tasks, setTasks] = useState<Task[]>(initial.tasks);
  const [users, setUsers] = useState<User[]>(initial.users);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const state = localStorage.getItem("breedops-demo-state");
    const current = localStorage.getItem("breedops-demo-session");
    if (state) {
      const data = JSON.parse(state) as typeof initial;
      setCrosses(data.crosses);
      setScores(data.scores);
      setStock(data.stock);
      setTasks(data.tasks);
      setUsers(data.users);
    }
    if (current) setSession(JSON.parse(current));
  }, []);
  useEffect(
    () =>
      localStorage.setItem(
        "breedops-demo-state",
        JSON.stringify({ crosses, scores, stock, tasks, users }),
      ),
    [crosses, scores, stock, tasks, users],
  );
  const metrics = useMemo(
    () => ({
      yield:
        crosses.reduce((total, item) => total + item.seeds / item.units, 0) /
        Math.max(1, crosses.length),
      alerts: stock.filter(
        (item) => item.quantity <= item.minimum || item.expires <= "2026-12-07",
      ).length,
      overdue: tasks.filter(
        (item) => item.status !== "Terminé" && item.due < "2026-09-07",
      ).length,
    }),
    [crosses, stock, tasks],
  );
  if (!session)
    return (
      <Login
        onLogin={(name, role) => {
          const next = { name, role };
          localStorage.setItem("breedops-demo-session", JSON.stringify(next));
          setSession(next);
        }}
      />
    );
  const reset = () => {
    localStorage.removeItem("breedops-demo-state");
    setCrosses(initial.crosses);
    setScores(initial.scores);
    setStock(initial.stock);
    setTasks(initial.tasks);
    setUsers(initial.users);
    setNotice("Données de démonstration réinitialisées.");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <b>BO</b>
          <div>
            <strong>BreedOps</strong>
            <small>Équipe Démonstration</small>
          </div>
        </div>
        <nav>
          {(Object.keys(labels) as View[]).map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {labels[item]}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <small>
            {session.name}
            <br />
            {roleLabel(session.role)}
          </small>
          <button
            onClick={() => {
              localStorage.removeItem("breedops-demo-session");
              setSession(null);
            }}
          >
            Déconnexion
          </button>
          <button className="quiet" onClick={reset}>
            Réinitialiser la démo
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <p className="eyebrow">Mode démonstration local</p>
            <h1>{labels[view]}</h1>
          </div>
          <button
            onClick={() =>
              download("breedops-sauvegarde", [
                {
                  croisements: crosses.length,
                  notations: scores.length,
                  articles: stock.length,
                  taches: tasks.length,
                },
              ])
            }
          >
            Sauvegarde CSV
          </button>
        </header>
        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {view === "dashboard" && (
          <Dashboard metrics={metrics} stock={stock} tasks={tasks} />
        )}
        {view === "crosses" && (
          <CrossModule
            crosses={crosses}
            setCrosses={setCrosses}
            notice={setNotice}
          />
        )}
        {view === "phenotypes" && (
          <PhenotypeModule
            scores={scores}
            setScores={setScores}
            notice={setNotice}
          />
        )}
        {view === "inventory" && (
          <InventoryModule
            stock={stock}
            setStock={setStock}
            notice={setNotice}
          />
        )}
        {view === "calendar" && (
          <CalendarModule
            tasks={tasks}
            setTasks={setTasks}
            users={users}
            notice={setNotice}
          />
        )}
        {view === "import" && (
          <ImportModule
            crosses={crosses}
            setCrosses={setCrosses}
            notice={setNotice}
          />
        )}
        {view === "team" && (
          <TeamModule
            users={users}
            setUsers={setUsers}
            canManage={session.role !== "user"}
            notice={setNotice}
          />
        )}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (name: string, role: Role) => void }) {
  const [forgot, setForgot] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onLogin(
      String(form.get("name") || "Utilisateur démo"),
      String(form.get("role")) as Role,
    );
  };
  return (
    <main className="login">
      <section>
        <p className="eyebrow">BreedOps</p>
        <h1>Suivi de sélection végétale</h1>
        <p>
          MVP testable : croisements, notation, inventaire et planning par
          équipe.
        </p>
        <ul>
          <li>Une équipe et des utilisateurs</li>
          <li>Rôles simples</li>
          <li>Calculs et exports</li>
        </ul>
      </section>
      <form className="card form login-card" onSubmit={submit}>
        <h2>{forgot ? "Réinitialiser le mot de passe" : "Connexion"}</h2>
        {forgot ? (
          <>
            <label>
              Email
              <input type="email" required placeholder="vous@exemple.fr" />
            </label>
            <button type="button" onClick={() => setForgot(false)}>
              Envoyer le lien de démo
            </button>
          </>
        ) : (
          <>
            <label>
              Nom
              <input name="name" defaultValue="Marie Martin" required />
            </label>
            <label>
              Rôle de test
              <select name="role" defaultValue="team_admin">
                <option value="system_admin">Administrateur application</option>
                <option value="team_admin">Administrateur équipe</option>
                <option value="user">Utilisateur</option>
              </select>
            </label>
            <label>
              Mot de passe
              <input type="password" defaultValue="demo" required />
            </label>
            <button>Se connecter</button>
            <button
              className="quiet"
              type="button"
              onClick={() => setForgot(true)}
            >
              Mot de passe oublié
            </button>
          </>
        )}
      </form>
    </main>
  );
}
function Dashboard({
  metrics,
  stock,
  tasks,
}: {
  metrics: { yield: number; alerts: number; overdue: number };
  stock: Stock[];
  tasks: Task[];
}) {
  return (
    <>
      <section className="metrics">
        <Metric
          label="Rendement moyen"
          value={metrics.yield.toFixed(1) + " graines/unité"}
        />
        <Metric label="Germination" value="92%" />
        <Metric label="Alertes inventaire" value={metrics.alerts} warn />
        <Metric label="Tâches en retard" value={metrics.overdue} warn />
      </section>
      <section className="grid-2">
        <article className="card">
          <h2>Alertes</h2>
          {stock.map((item) => (
            <p key={item.lot}>
              <b>{item.name}</b>
              <br />
              <small>
                {item.quantity} en stock · péremption {item.expires}
              </small>
            </p>
          ))}
        </article>
        <article className="card">
          <h2>Planning</h2>
          {tasks.map((task) => (
            <p key={task.title}>
              <b>{task.title}</b>
              <br />
              <small>
                {task.due} · {task.status} · {task.owner}
              </small>
            </p>
          ))}
        </article>
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <article className={"metric" + (warn ? " warn" : "")}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}
function CrossModule({
  crosses,
  setCrosses,
  notice,
}: {
  crosses: Cross[];
  setCrosses: (value: Cross[]) => void;
  notice: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setCrosses([
      ...crosses,
      {
        code: String(f.get("code")),
        female: String(f.get("female")),
        male: String(f.get("male")),
        seeds: Number(f.get("seeds")),
        units: Number(f.get("units")),
        status: "Actif",
      },
    ]);
    event.currentTarget.reset();
    notice("Croisement, famille et lot créés.");
  };
  return (
    <section className="split">
      <form className="card form" onSubmit={submit}>
        <h2>Nouveau croisement</h2>
        <label>
          Code
          <input name="code" required placeholder="X-2026-002" />
        </label>
        <label>
          Parent femelle
          <input name="female" required />
        </label>
        <label>
          Parent mâle
          <input name="male" required />
        </label>
        <label>
          Unités pollinisées
          <input name="units" type="number" min="1" required />
        </label>
        <label>
          Graines récoltées
          <input name="seeds" type="number" min="0" required />
        </label>
        <button>Créer</button>
      </form>
      <article className="card">
        <h2>Registre et lots</h2>
        <Table
          headers={["Code", "Femelle", "Mâle", "Rendement", "Statut"]}
          rows={crosses.map((item) => [
            item.code,
            item.female,
            item.male,
            (item.seeds / item.units).toFixed(1),
            item.status,
          ])}
        />
        <button onClick={() => download("croisements", crosses)}>
          Exporter CSV
        </button>
      </article>
    </section>
  );
}
function PhenotypeModule({
  scores,
  setScores,
  notice,
}: {
  scores: Score[];
  setScores: (value: Score[]) => void;
  notice: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setScores([
      ...scores,
      {
        code: String(f.get("code")),
        vigor: Number(f.get("vigor")),
        yield: Number(f.get("yield")),
        stability: Number(f.get("stability")),
      },
    ]);
    event.currentTarget.reset();
    notice("Notation enregistrée : score et décision recalculés.");
  };
  return (
    <section className="split">
      <form className="card form" onSubmit={submit}>
        <h2>Nouvelle notation</h2>
        <label>
          Individu
          <input name="code" required placeholder="PHENO-002" />
        </label>
        <label>
          Vigueur /10
          <input name="vigor" type="number" min="0" max="10" required />
        </label>
        <label>
          Rendement /10 (×2)
          <input name="yield" type="number" min="0" max="10" required />
        </label>
        <label>
          Stabilité /10 (×4)
          <input name="stability" type="number" min="0" max="10" required />
        </label>
        <button>Calculer</button>
      </form>
      <article className="card">
        <h2>Matrice de sélection</h2>
        <Table
          headers={["Individu", "Pondéré", "Normalisé", "Décision"]}
          rows={scores.map((item) => [
            item.code,
            weighted(item) + "/130",
            ((weighted(item) / 130) * 100).toFixed(1) + "%",
            selection(item),
          ])}
        />
        <button
          onClick={() =>
            download(
              "selection",
              scores.map((item) => ({ ...item, decision: selection(item) })),
            )
          }
        >
          Exporter matrice CSV
        </button>
      </article>
    </section>
  );
}
function InventoryModule({
  stock,
  setStock,
  notice,
}: {
  stock: Stock[];
  setStock: (value: Stock[]) => void;
  notice: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setStock(
      stock.map((item, i) =>
        i === 0
          ? {
              ...item,
              quantity: Math.max(0, item.quantity + Number(f.get("quantity"))),
            }
          : item,
      ),
    );
    event.currentTarget.reset();
    notice("Mouvement tracé et stock recalculé.");
  };
  return (
    <section className="split">
      <form className="card form" onSubmit={submit}>
        <h2>Mouvement de stock</h2>
        <p>
          Valeur positive : réception. Valeur négative : consommation,
          ajustement ou destruction.
        </p>
        <label>
          Quantité
          <input name="quantity" type="number" required />
        </label>
        <label>
          Justification
          <input name="reason" required placeholder="Consommation serre A" />
        </label>
        <button>Enregistrer</button>
      </form>
      <article className="card">
        <h2>Articles et lots</h2>
        <Table
          headers={[
            "Article",
            "Lot",
            "Quantité",
            "Seuil",
            "Péremption",
            "Alerte",
          ]}
          rows={stock.map((item) => [
            item.name,
            item.lot,
            item.quantity,
            item.minimum,
            item.expires,
            item.quantity <= item.minimum ? "COMMANDER" : "OK",
          ])}
        />
        <button onClick={() => download("inventaire", stock)}>
          Exporter inventaire CSV
        </button>
      </article>
    </section>
  );
}
function CalendarModule({
  tasks,
  setTasks,
  users,
  notice,
}: {
  tasks: Task[];
  setTasks: (value: Task[]) => void;
  users: User[];
  notice: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setTasks([
      ...tasks,
      {
        title: String(f.get("title")),
        due: String(f.get("due")),
        owner: String(f.get("owner")),
        status: "Planifié",
      },
    ]);
    event.currentTarget.reset();
    notice("Tâche ajoutée au calendrier.");
  };
  return (
    <section className="split">
      <form className="card form" onSubmit={submit}>
        <h2>Planifier une tâche</h2>
        <label>
          Tâche
          <input name="title" required />
        </label>
        <label>
          Échéance
          <input name="due" type="date" required />
        </label>
        <label>
          Responsable
          <select name="owner">
            {users.map((user) => (
              <option key={user.email}>{user.name}</option>
            ))}
          </select>
        </label>
        <button>Ajouter</button>
      </form>
      <article className="card">
        <h2>Gantt simplifié</h2>
        {tasks.map((task, index) => (
          <div className="task" key={task.title + index}>
            <div>
              <b>{task.title}</b>
              <small>
                {task.owner} · {task.due}
              </small>
            </div>
            <select
              value={task.status}
              onChange={(e) =>
                setTasks(
                  tasks.map((item, i) =>
                    i === index ? { ...item, status: e.target.value } : item,
                  ),
                )
              }
            >
              <option>Planifié</option>
              <option>En cours</option>
              <option>Bloqué</option>
              <option>Terminé</option>
              <option>Annulé</option>
            </select>
            <div className="bar">
              <span style={{ width: Math.min(100, 35 + index * 20) + "%" }} />
            </div>
          </div>
        ))}
      </article>
    </section>
  );
}
function ImportModule({
  crosses,
  setCrosses,
  notice,
}: {
  crosses: Cross[];
  setCrosses: (value: Cross[]) => void;
  notice: (value: string) => void;
}) {
  const [preview, setPreview] = useState<Cross[]>([]);
  const read = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result)
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => {
          const [code, female, male, seeds, units] = line
            .split(",")
            .map((cell) => cell.trim());
          return {
            code,
            female,
            male,
            seeds: Number(seeds),
            units: Number(units),
            status: "Actif",
          };
        })
        .filter(
          (item) =>
            item.code &&
            Number.isFinite(item.seeds) &&
            Number.isFinite(item.units),
        );
      setPreview(rows);
    };
    reader.readAsText(file);
  };
  return (
    <section className="grid-2">
      <article className="card">
        <h2>Importer des croisements CSV</h2>
        <p>
          Colonnes : <code>code,female,male,seeds,units</code>.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={read} />
        {preview.length > 0 && (
          <>
            <p>{preview.length} ligne(s) valide(s) à importer.</p>
            <button
              onClick={() => {
                setCrosses([...crosses, ...preview]);
                setPreview([]);
                notice("Import de démonstration terminé.");
              }}
            >
              Importer
            </button>
          </>
        )}
      </article>
      <article className="card">
        <h2>Exports et sauvegarde</h2>
        <p>
          Les exports CSV s’ouvrent dans Excel et LibreOffice. Les contrôles de
          colonnes et la prévisualisation sont inclus.
        </p>
        <button onClick={() => download("croisements", crosses)}>
          Exporter les croisements
        </button>
      </article>
    </section>
  );
}
function TeamModule({
  users,
  setUsers,
  canManage,
  notice,
}: {
  users: User[];
  setUsers: (value: User[]) => void;
  canManage: boolean;
  notice: (value: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setUsers([
      ...users,
      {
        name: String(f.get("name")),
        email: String(f.get("email")),
        role: String(f.get("role")) as Role,
      },
    ]);
    event.currentTarget.reset();
    notice("Compte équipe créé en mode démo.");
  };
  return (
    <section className="split">
      {canManage ? (
        <form className="card form" onSubmit={submit}>
          <h2>Ajouter un compte équipe</h2>
          <label>
            Nom
            <input name="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Rôle
            <select name="role">
              <option value="user">Utilisateur</option>
              <option value="team_admin">Administrateur équipe</option>
            </select>
          </label>
          <button>Ajouter</button>
        </form>
      ) : (
        <article className="card">
          <h2>Accès limité</h2>
          <p>Seul un administrateur peut gérer les comptes.</p>
        </article>
      )}
      <article className="card">
        <h2>Utilisateurs</h2>
        <Table
          headers={["Nom", "Email", "Rôle"]}
          rows={users.map((user) => [
            user.name,
            user.email,
            roleLabel(user.role),
          ])}
        />
      </article>
    </section>
  );
}
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
