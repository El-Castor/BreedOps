import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon } from "@/components/icons";
import {
  ActionMenu,
  Card,
  DataTable,
  EmptyState,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { formatDay } from "@/lib/breeding-entity-details";
import {
  addCycleTemplateStep,
  addTemplateChecklistItem,
  addTemplateDependency,
  archiveCycleTemplate,
  archiveTaskTemplate,
  createCycleTemplate,
  createTaskTemplate,
  instantiateCycle,
  moveCycleTemplateStep,
  previewCycleSchedule,
  removeCycleTemplateStep,
  removeTemplateChecklistItem,
  removeTemplateDependency,
  restoreCycleTemplate,
  restoreTaskTemplate,
  updateCycleTemplate,
  updateCycleTemplateStep,
  updateTaskTemplate,
} from "./actions";
import { buildHref, priorityLabels, type OperationsParams } from "./filters";

type Client = Awaited<ReturnType<typeof requireIdentity>>["client"];

type TaskTemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  zone: string | null;
  priority: string;
  sop_code: string | null;
  expected_deliverable: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

type CycleTemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  deleted_at: string | null;
};

type StepRow = {
  id: string;
  cycle_template_id: string;
  task_template_id: string;
  start_offset_days: number;
  duration_days: number;
  default_assigned_to: string | null;
  sort_order: number;
};

type TemplateDependencyRow = {
  id: string;
  predecessor_template_task_id: string;
  successor_template_task_id: string;
  lag_days: number;
};

export async function TemplatesView({
  client,
  programId,
  params,
  profiles,
}: {
  client: Client;
  programId: string;
  params: OperationsParams;
  profiles: { id: string; display_name: string | null; user_id: string }[];
}) {
  const [taskTemplatesResult, cycleTemplatesResult] = await Promise.all([
    client
      .from("task_templates")
      .select(
        "id,code,name,description,zone,priority,sop_code,expected_deliverable,is_active,deleted_at",
      )
      .eq("program_id", programId)
      .order("name"),
    client
      .from("experimental_cycle_templates")
      .select("id,code,name,description,is_active,deleted_at")
      .eq("program_id", programId)
      .order("name"),
  ]);
  const taskTemplates = (taskTemplatesResult.data ?? []) as TaskTemplateRow[];
  const cycleTemplates = (cycleTemplatesResult.data ??
    []) as CycleTemplateRow[];

  const selectedTemplate = cycleTemplates.find((t) => t.id === params.template);

  let steps: StepRow[] = [];
  let dependencies: TemplateDependencyRow[] = [];
  let usageCounts: Record<string, number> = {};
  if (selectedTemplate) {
    const [stepsResult, dependenciesResult] = await Promise.all([
      client
        .from("experimental_cycle_template_tasks")
        .select(
          "id,cycle_template_id,task_template_id,start_offset_days,duration_days,default_assigned_to,sort_order",
        )
        .eq("cycle_template_id", selectedTemplate.id)
        .order("sort_order"),
      client
        .from("experimental_cycle_template_dependencies")
        .select(
          "id,predecessor_template_task_id,successor_template_task_id,lag_days",
        )
        .eq("cycle_template_id", selectedTemplate.id),
    ]);
    steps = (stepsResult.data ?? []) as StepRow[];
    dependencies = (dependenciesResult.data ?? []) as TemplateDependencyRow[];
  }
  {
    const { data } = await client
      .from("experimental_cycle_template_tasks")
      .select("task_template_id")
      .in(
        "task_template_id",
        taskTemplates.map((t) => t.id).length
          ? taskTemplates.map((t) => t.id)
          : [""],
      );
    usageCounts = (data ?? []).reduce<Record<string, number>>((acc, row) => {
      const key = (row as { task_template_id: string }).task_template_id;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }

  const taskTemplateName = (id: string) =>
    taskTemplates.find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="section-block">
      <SectionHeader
        title="Modèles de tâches"
        description="Opérations réutilisables : contrôles SOP, zone et priorité par défaut."
        aside={
          <FormDrawer
            label="Nouveau modèle de tâche"
            title="Nouveau modèle de tâche"
            icon="add"
            variant="secondary"
          >
            <ActionForm
              action={createTaskTemplate}
              actionName="task-template-create"
              submitLabel="Créer le modèle"
            >
              <input type="hidden" name="program_id" value={programId} />
              <TaskTemplateFields />
            </ActionForm>
          </FormDrawer>
        }
      />
      <Card className="flush">
        {!taskTemplates.length ? (
          <EmptyState
            title="Aucun modèle de tâche"
            message="Créez un modèle pour éviter de ressaisir les mêmes opérations."
          />
        ) : (
          <DataTable label="Modèles de tâches">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Code</th>
                  <th>Priorité</th>
                  <th>Zone</th>
                  <th>SOP</th>
                  <th>Actif</th>
                  <th>Utilisation</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {taskTemplates.map((template) => (
                  <tr
                    key={template.id}
                    className={template.deleted_at ? "archived-row" : ""}
                  >
                    <td>
                      <strong>{template.name}</strong>
                    </td>
                    <td className="code">{template.code}</td>
                    <td>
                      {priorityLabels[template.priority] ?? template.priority}
                    </td>
                    <td>{template.zone || "—"}</td>
                    <td>{template.sop_code || "—"}</td>
                    <td>
                      <StatusBadge
                        tone={template.is_active ? "success" : "neutral"}
                      >
                        {template.is_active ? "Actif" : "Inactif"}
                      </StatusBadge>
                    </td>
                    <td className="num">{usageCounts[template.id] ?? 0}</td>
                    <td className="cell-actions">
                      <div className="register-actions">
                        <FormDrawer
                          label="Modifier"
                          title="Modifier le modèle de tâche"
                          icon="edit"
                          variant="secondary"
                        >
                          <ActionForm
                            action={updateTaskTemplate}
                            actionName={`task-template-update-${template.id}`}
                            submitLabel="Enregistrer"
                            resetOnSuccess={false}
                          >
                            <input
                              type="hidden"
                              name="task_template_id"
                              value={template.id}
                            />
                            <TaskTemplateFields template={template} />
                          </ActionForm>
                          <ChecklistEditor
                            client={client}
                            taskTemplateId={template.id}
                          />
                        </FormDrawer>
                        <ActionMenu label={`Actions pour ${template.name}`}>
                          <ActionForm
                            action={
                              template.deleted_at
                                ? restoreTaskTemplate
                                : archiveTaskTemplate
                            }
                            actionName={`task-template-lifecycle-${template.id}`}
                            className="entity-lifecycle-form"
                            submitLabel={
                              template.deleted_at ? "Restaurer" : "Archiver"
                            }
                            revealOnFlash={false}
                          >
                            <input
                              type="hidden"
                              name="task_template_id"
                              value={template.id}
                            />
                          </ActionForm>
                        </ActionMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>

      <SectionHeader
        title="Modèles de workflow expérimental"
        description="Un modèle regroupe des étapes ordonnées avec dépendances ; l’instanciation génère un cycle réel."
        aside={
          <FormDrawer
            label="Nouveau modèle de workflow"
            title="Nouveau modèle de workflow"
            icon="add"
          >
            <ActionForm
              action={createCycleTemplate}
              actionName="cycle-template-create"
              submitLabel="Créer le modèle"
            >
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Nom
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Code
                <input name="code" required maxLength={40} />
              </label>
              <label>
                Description
                <input name="description" maxLength={2000} />
              </label>
            </ActionForm>
          </FormDrawer>
        }
      />
      <Card className="flush">
        {!cycleTemplates.length ? (
          <EmptyState
            title="Aucun modèle de workflow"
            message="Créez un modèle pour planifier automatiquement un cycle expérimental complet."
          />
        ) : (
          <ul className="template-list">
            {cycleTemplates.map((template) => (
              <li
                key={template.id}
                className={template.deleted_at ? "archived-row" : ""}
              >
                <a
                  href={buildHref(params, programId, { template: template.id })}
                  aria-current={
                    selectedTemplate?.id === template.id ? "page" : undefined
                  }
                >
                  <strong>{template.name}</strong>
                  <span className="code">{template.code}</span>
                  {!template.is_active && (
                    <StatusBadge tone="neutral">Inactif</StatusBadge>
                  )}
                  {template.deleted_at && (
                    <StatusBadge tone="neutral">Archivé</StatusBadge>
                  )}
                </a>
                <div className="register-actions">
                  <FormDrawer
                    label="Modifier"
                    title="Modifier le modèle"
                    icon="edit"
                    variant="secondary"
                  >
                    <ActionForm
                      action={updateCycleTemplate}
                      actionName={`cycle-template-update-${template.id}`}
                      submitLabel="Enregistrer"
                      resetOnSuccess={false}
                    >
                      <input
                        type="hidden"
                        name="cycle_template_id"
                        value={template.id}
                      />
                      <label>
                        Nom
                        <input
                          name="name"
                          defaultValue={template.name}
                          required
                          maxLength={160}
                        />
                      </label>
                      <label>
                        Code
                        <input
                          name="code"
                          defaultValue={template.code}
                          required
                          maxLength={40}
                        />
                      </label>
                      <label>
                        Description
                        <input
                          name="description"
                          defaultValue={template.description ?? ""}
                          maxLength={2000}
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          name="is_active"
                          value="true"
                          defaultChecked={template.is_active}
                        />
                        Actif
                      </label>
                      <input type="hidden" name="is_active" value="false" />
                    </ActionForm>
                  </FormDrawer>
                  <ActionMenu label={`Actions pour ${template.name}`}>
                    <ActionForm
                      action={
                        template.deleted_at
                          ? restoreCycleTemplate
                          : archiveCycleTemplate
                      }
                      actionName={`cycle-template-lifecycle-${template.id}`}
                      className="entity-lifecycle-form"
                      submitLabel={
                        template.deleted_at ? "Restaurer" : "Archiver"
                      }
                      revealOnFlash={false}
                    >
                      <input
                        type="hidden"
                        name="cycle_template_id"
                        value={template.id}
                      />
                    </ActionForm>
                  </ActionMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selectedTemplate && (
        <CycleTemplateBuilder
          template={selectedTemplate}
          steps={steps}
          dependencies={dependencies}
          taskTemplates={taskTemplates.filter(
            (t) => !t.deleted_at && t.is_active,
          )}
          profiles={profiles}
          taskTemplateName={taskTemplateName}
          params={params}
          programId={programId}
        />
      )}
    </div>
  );
}

function TaskTemplateFields({ template }: { template?: TaskTemplateRow }) {
  return (
    <>
      <div className="fields-2">
        <label>
          Nom
          <input
            name="name"
            defaultValue={template?.name}
            required
            maxLength={160}
          />
        </label>
        <label>
          Code
          <input
            name="code"
            defaultValue={template?.code}
            required
            maxLength={40}
          />
        </label>
      </div>
      <label>
        Description
        <input
          name="description"
          defaultValue={template?.description ?? ""}
          maxLength={2000}
        />
      </label>
      <div className="fields-2">
        <label>
          Zone par défaut
          <input
            name="zone"
            defaultValue={template?.zone ?? ""}
            maxLength={120}
          />
        </label>
        <label>
          Priorité par défaut
          <select name="priority" defaultValue={template?.priority ?? "medium"}>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fields-2">
        <label>
          Code SOP
          <input
            name="sop_code"
            defaultValue={template?.sop_code ?? ""}
            maxLength={60}
          />
        </label>
        <label>
          Livrable attendu
          <input
            name="expected_deliverable"
            defaultValue={template?.expected_deliverable ?? ""}
            maxLength={500}
          />
        </label>
      </div>
      {template && (
        <>
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="is_active"
              value="true"
              defaultChecked={template.is_active}
            />
            Actif
          </label>
          <input type="hidden" name="is_active" value="false" />
        </>
      )}
    </>
  );
}

async function ChecklistEditor({
  client,
  taskTemplateId,
}: {
  client: Client;
  taskTemplateId: string;
}) {
  const { data } = await client
    .from("task_template_checklist_items")
    .select("id,label,is_required,sort_order")
    .eq("task_template_id", taskTemplateId)
    .order("sort_order");
  const items = (data ?? []) as {
    id: string;
    label: string;
    is_required: boolean;
  }[];
  return (
    <section aria-label="Contrôles SOP du modèle">
      <h3 className="icon-heading">
        <Icon name="check" size={14} />
        Contrôles SOP
      </h3>
      {items.length > 0 && (
        <ul className="checklist">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                {item.label}
                {item.is_required && (
                  <StatusBadge tone="warning">Obligatoire</StatusBadge>
                )}
              </span>
              <ActionForm
                action={removeTemplateChecklistItem}
                actionName={`template-checklist-remove-${item.id}`}
                className="inline-action"
                submitLabel="Retirer"
                resetOnSuccess={false}
              >
                <input type="hidden" name="item_id" value={item.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <ActionForm
        action={addTemplateChecklistItem}
        actionName={`template-checklist-add-${taskTemplateId}`}
        className="inline-form"
        submitLabel="Ajouter"
        resetOnSuccess
      >
        <input type="hidden" name="task_template_id" value={taskTemplateId} />
        <input
          name="label"
          placeholder="Nouveau contrôle"
          required
          maxLength={300}
        />
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="is_required"
            value="true"
            defaultChecked
          />
          Obligatoire
        </label>
        <input type="hidden" name="is_required" value="false" />
      </ActionForm>
    </section>
  );
}

function CycleTemplateBuilder({
  template,
  steps,
  dependencies,
  taskTemplates,
  profiles,
  taskTemplateName,
  params,
  programId,
}: {
  template: CycleTemplateRow;
  steps: StepRow[];
  dependencies: TemplateDependencyRow[];
  taskTemplates: TaskTemplateRow[];
  profiles: { id: string; display_name: string | null; user_id: string }[];
  taskTemplateName: (id: string) => string;
  params: OperationsParams;
  programId: string;
}) {
  const assignedToName = (profileId: string | null) =>
    profiles.find((p) => p.id === profileId)?.display_name || "Non assigné";
  return (
    <>
      <SectionHeader
        title={`Étapes — ${template.name}`}
        description="Ordre, durée et décalage par rapport au début du cycle."
        aside={
          <FormDrawer
            label="Ajouter une étape"
            title="Ajouter une étape"
            icon="add"
            variant="secondary"
          >
            <ActionForm
              action={addCycleTemplateStep}
              actionName={`step-add-${template.id}`}
              submitLabel="Ajouter"
            >
              <input
                type="hidden"
                name="cycle_template_id"
                value={template.id}
              />
              <label>
                Modèle de tâche
                <select name="task_template_id" required>
                  <option value="">Choisir</option>
                  {taskTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fields-2">
                <label>
                  Décalage (jours depuis le début)
                  <input
                    type="number"
                    name="start_offset_days"
                    defaultValue={0}
                    min={0}
                    required
                  />
                </label>
                <label>
                  Durée (jours)
                  <input
                    type="number"
                    name="duration_days"
                    defaultValue={1}
                    min={1}
                    required
                  />
                </label>
              </div>
              <label>
                Responsable par défaut
                <select name="default_assigned_to" defaultValue="">
                  <option value="">Non assigné</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name || p.user_id}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </FormDrawer>
        }
      />
      <Card className="flush">
        {!steps.length ? (
          <EmptyState
            title="Aucune étape"
            message="Ajoutez la première étape du workflow."
          />
        ) : (
          <DataTable label="Étapes du modèle">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Étape</th>
                  <th>Décalage</th>
                  <th>Durée</th>
                  <th>Responsable</th>
                  <th>Ordre</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => (
                  <tr key={step.id}>
                    <td className="num">{index + 1}</td>
                    <td>{taskTemplateName(step.task_template_id)}</td>
                    <td className="num">J+{step.start_offset_days}</td>
                    <td className="num">{step.duration_days} j</td>
                    <td>{assignedToName(step.default_assigned_to)}</td>
                    <td className="cell-actions">
                      <div className="register-actions">
                        <ActionForm
                          action={moveCycleTemplateStep}
                          actionName={`step-up-${step.id}`}
                          className="inline-action"
                          submitLabel="Monter"
                          submitContent={<Icon name="up" size={14} />}
                          resetOnSuccess={false}
                        >
                          <input
                            type="hidden"
                            name="cycle_template_id"
                            value={template.id}
                          />
                          <input
                            type="hidden"
                            name="template_task_id"
                            value={step.id}
                          />
                          <input type="hidden" name="step" value="-1" />
                        </ActionForm>
                        <ActionForm
                          action={moveCycleTemplateStep}
                          actionName={`step-down-${step.id}`}
                          className="inline-action"
                          submitLabel="Descendre"
                          submitContent={<Icon name="down" size={14} />}
                          resetOnSuccess={false}
                        >
                          <input
                            type="hidden"
                            name="cycle_template_id"
                            value={template.id}
                          />
                          <input
                            type="hidden"
                            name="template_task_id"
                            value={step.id}
                          />
                          <input type="hidden" name="step" value="1" />
                        </ActionForm>
                      </div>
                    </td>
                    <td className="cell-actions">
                      <div className="register-actions">
                        <FormDrawer
                          label="Modifier"
                          title="Modifier l’étape"
                          icon="edit"
                          variant="secondary"
                        >
                          <ActionForm
                            action={updateCycleTemplateStep}
                            actionName={`step-update-${step.id}`}
                            submitLabel="Enregistrer"
                            resetOnSuccess={false}
                          >
                            <input
                              type="hidden"
                              name="template_task_id"
                              value={step.id}
                            />
                            <div className="fields-2">
                              <label>
                                Décalage (jours)
                                <input
                                  type="number"
                                  name="start_offset_days"
                                  defaultValue={step.start_offset_days}
                                  min={0}
                                  required
                                />
                              </label>
                              <label>
                                Durée (jours)
                                <input
                                  type="number"
                                  name="duration_days"
                                  defaultValue={step.duration_days}
                                  min={1}
                                  required
                                />
                              </label>
                            </div>
                            <label>
                              Responsable par défaut
                              <select
                                name="default_assigned_to"
                                defaultValue={step.default_assigned_to ?? ""}
                              >
                                <option value="">Non assigné</option>
                                {profiles.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.display_name || p.user_id}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </ActionForm>
                        </FormDrawer>
                        <ActionForm
                          action={removeCycleTemplateStep}
                          actionName={`step-remove-${step.id}`}
                          className="inline-action"
                          submitLabel="Retirer"
                          resetOnSuccess={false}
                        >
                          <input
                            type="hidden"
                            name="template_task_id"
                            value={step.id}
                          />
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>

      <SectionHeader
        title="Dépendances"
        description="Finish-to-start uniquement : la tâche suivante démarre après l’échéance de la précédente (+ délai)."
      />
      <Card className="flush">
        {dependencies.length > 0 && (
          <ul className="dependency-list">
            {dependencies.map((dependency) => {
              const predecessorStep = steps.find(
                (s) => s.id === dependency.predecessor_template_task_id,
              );
              const successorStep = steps.find(
                (s) => s.id === dependency.successor_template_task_id,
              );
              return (
                <li key={dependency.id}>
                  {predecessorStep &&
                    taskTemplateName(predecessorStep.task_template_id)}{" "}
                  →{" "}
                  {successorStep &&
                    taskTemplateName(successorStep.task_template_id)}
                  {dependency.lag_days > 0
                    ? ` (délai +${dependency.lag_days} j)`
                    : ""}
                  <ActionForm
                    action={removeTemplateDependency}
                    actionName={`dependency-remove-${dependency.id}`}
                    className="inline-action"
                    submitLabel="Retirer"
                    resetOnSuccess={false}
                  >
                    <input
                      type="hidden"
                      name="dependency_id"
                      value={dependency.id}
                    />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        {steps.length >= 2 && (
          <ActionForm
            action={addTemplateDependency}
            actionName={`dependency-add-${template.id}`}
            className="inline-form"
            submitLabel="Ajouter la dépendance"
          >
            <input type="hidden" name="cycle_template_id" value={template.id} />
            <label>
              Dépend de
              <select name="predecessor_template_task_id" required>
                <option value="">Choisir</option>
                {steps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {taskTemplateName(step.task_template_id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bloque
              <select name="successor_template_task_id" required>
                <option value="">Choisir</option>
                {steps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {taskTemplateName(step.task_template_id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Délai (jours)
              <input type="number" name="lag_days" defaultValue={0} min={0} />
            </label>
          </ActionForm>
        )}
      </Card>

      <SchedulePreview
        template={template}
        params={params}
        programId={programId}
        profiles={profiles}
      />
    </>
  );
}

async function SchedulePreview({
  template,
  params,
  programId,
  profiles,
}: {
  template: CycleTemplateRow;
  params: OperationsParams;
  programId: string;
  profiles: { id: string; display_name: string | null; user_id: string }[];
}) {
  const startDate = params.start;
  const result = startDate
    ? await previewCycleSchedule(template.id, startDate)
    : null;
  const assignedToName = (profileId: string | null) =>
    profiles.find((p) => p.id === profileId)?.display_name || "Non assigné";
  return (
    <>
      <SectionHeader
        title="Aperçu et instanciation"
        description="Choisissez une date de début pour prévisualiser le calendrier généré, sans rien enregistrer."
      />
      <Card>
        <form method="get" className="inline-form">
          <input type="hidden" name="program" value={programId} />
          <input type="hidden" name="tab" value="templates" />
          <input type="hidden" name="template" value={template.id} />
          <label>
            Date de début
            <input
              type="date"
              name="start"
              defaultValue={startDate ?? ""}
              required
            />
          </label>
          <button className="secondary">
            <Icon name="inspect" />
            Prévisualiser
          </button>
        </form>
        {result && "error" in result && (
          <p className="form-message error">{result.error}</p>
        )}
        {result && "rows" in result && (
          <>
            <DataTable label="Calendrier prévisionnel">
              <table>
                <thead>
                  <tr>
                    <th>Tâche</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th>Priorité</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.templateTaskId}>
                      <td>{row.title}</td>
                      <td className="num">{formatDay(row.plannedDate)}</td>
                      <td className="num">{formatDay(row.dueDate)}</td>
                      <td>{priorityLabels[row.priority] ?? row.priority}</td>
                      <td>{assignedToName(row.defaultAssignedTo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
            {result.cycleEndDate && (
              <p className="inspector-note">
                Date de fin du cycle calculée : {formatDay(result.cycleEndDate)}
              </p>
            )}
            <ActionForm
              action={instantiateCycle}
              actionName={`instantiate-${template.id}`}
              submitLabel="Créer le cycle"
              resetOnSuccess={false}
            >
              <input
                type="hidden"
                name="cycle_template_id"
                value={template.id}
              />
              <input type="hidden" name="start_date" value={startDate} />
              <label>
                Nom du cycle
                <input
                  name="cycle_name"
                  required
                  maxLength={160}
                  defaultValue={template.name}
                />
              </label>
            </ActionForm>
          </>
        )}
      </Card>
    </>
  );
}
