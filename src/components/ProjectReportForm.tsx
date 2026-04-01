"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import EmployeeSelect from "./EmployeeSelect";
import {
  Employee as EmployeeModel,
  employeeConverter,
} from "@/models/Employee";
import ProjectSelect from "@/components/ProjectSelect";
import { Button } from "./ui/button";
import { useEmployees } from "@/hooks/useEmployees";

import { ProjectReport, projectReportConverter, ProjectReportPDFMessage } from "@/models/ProjectReport";
import { toast } from "sonner";
import { ProjectHit } from "@/models/Project";
import { getDoc, getDocs, query, where } from "firebase/firestore";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "./ui/input";
import { firestore } from "@/lib/firebase";
import {
  addDoc,
  setDoc,
  Timestamp,
  doc,
  collection,
  onSnapshot,
  query as fsQuery,
  where as fsWhere,
} from "firebase/firestore";
import { getEmployeeByEmail } from "@/services/employeeService";
import { Loader2 } from "lucide-react";
import openAIClient from "@/lib/openai";
import { ProjectReportMessage } from "@/models/ProjectReport";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { PurchaseOrder, purchaseOrderConverter } from "@/models/PurchaseOrder";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

interface ProjectReportFormProps {
  projectReport?: ProjectReport;
  project?: ProjectHit | null;
  authorTechnician: EmployeeModel;
}

// Zod schema for the form
const projectReportFormSchema = z.object({
  projectDocId: z.number().min(1, "Project is required"),
  leadTechnicianId: z.string().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()),
  notes: z.string().min(1, "Notes are required"),
  additionalMaterials: z.string(),
  linkPurchaseOrders: z.boolean(),
});

type ProjectReportFormValues = z.infer<typeof projectReportFormSchema>;

export default function ProjectReportForm({
  projectReport,
  project: initialProject,
  authorTechnician: initialAuthorTechnician,
}: ProjectReportFormProps) {
  const {
    employees,
    technicians,
    loading: loadingEmployees,
    error: employeesError,
    refetch: refetchEmployees,
  } = useEmployees();
  const { user } = useAuth();

  // UI state (not form data)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [rephraseDialogOpen, setRephraseDialogOpen] = useState<boolean>(false);
  const [rephrase, setRephrase] = useState<string | null>(null);
  const [isRephrasing, setIsRephrasing] = useState<boolean>(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);
  
  // External data state (not form data)
  const [authorTechnician] = useState<EmployeeModel>(initialAuthorTechnician);
  const [isNewReport, setIsNewReport] = useState<boolean>(!projectReport);
  const [docId, setDocId] = useState<number>(projectReport?.docId || 0);
  const [project, setProject] = useState<ProjectHit | null>(initialProject || null);
  const [leadEmployee, setLeadEmployee] = useState<EmployeeModel | null>(null);
  const [assignedTechnicians, setAssignedTechnicians] = useState<EmployeeModel[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loadingPurchaseOrders, setLoadingPurchaseOrders] = useState<boolean>(false);

  // Initialize form with react-hook-form
  const form = useForm<ProjectReportFormValues>({
    resolver: zodResolver(projectReportFormSchema),
    defaultValues: {
      projectDocId: initialProject?.docId || 0,
      leadTechnicianId: null,
      assignedTechnicianIds: [],
      notes: projectReport?.notes || "",
      additionalMaterials: projectReport?.materials || "",
      linkPurchaseOrders: false,
    },
  });

  const { watch, setValue, getValues } = form;
  const linkPurchaseOrders = watch("linkPurchaseOrders");

  // Sync project selection with form state
  useEffect(() => {
    if (project) {
      setValue("projectDocId", project.docId);
    } else {
      setValue("projectDocId", 0);
    }
  }, [project, setValue]);

  // Initialize form data from projectReport
  useEffect(() => {
    async function initForm() {
      if (!projectReport) return;

      if (projectReport.leadTechnicianRef) {
        const employeeSnap = await getDoc(
          projectReport.leadTechnicianRef.withConverter(employeeConverter)
        );
        if (employeeSnap.exists()) {
          const emp = employeeSnap.data() as EmployeeModel;
          setLeadEmployee({
            ...emp,
            id: employeeSnap.id,
          });
          setValue("leadTechnicianId", employeeSnap.id);
        }
      }

      if (projectReport.assignedTechniciansRef) {
        const assignedEmps: EmployeeModel[] = [];
        const assignedIds: string[] = [];
        for (const ref of projectReport.assignedTechniciansRef) {
          const empDoc = await getDoc(ref);
          if (empDoc.exists()) {
            const d = empDoc.data();
            const emp = {
              id: empDoc.id,
              clientId: d["client-id"],
              clientSecret: d["client-secret"],
              createdAt: d["created-at"],
              updatedAt: d["updated-at"],
              ...d,
            } as EmployeeModel;
            assignedEmps.push(emp);
            assignedIds.push(empDoc.id);
          }
        }
        setAssignedTechnicians(assignedEmps);
        setValue("assignedTechnicianIds", assignedIds);
      }

      // Pre-fill form values
      setValue("notes", projectReport.notes || "");
      setValue("additionalMaterials", projectReport.materials || "");
      setValue("projectDocId", projectReport.projectDocId);

      // set report identifiers
      setDocId(projectReport.docId);
      setIsNewReport(false);
    }

    initForm();
  }, [projectReport, setValue]);

  const handleAddTechnician = (emp: EmployeeModel) => {
    if (!assignedTechnicians.some((existing) => existing.id === emp.id)) {
      setAssignedTechnicians((prev) => [...prev, emp]);
      const currentIds = getValues("assignedTechnicianIds");
      setValue("assignedTechnicianIds", [...currentIds, emp.id]);
    }
  };

  const handleRemoveTechnician = (empId: string) => {
    setAssignedTechnicians((prev) => prev.filter((e) => e.id !== empId));
    const currentIds = getValues("assignedTechnicianIds");
    setValue("assignedTechnicianIds", currentIds.filter((id) => id !== empId));
  };

  // Filter employees to include both technicians and admins for lead technician selection
  const leadTechnicianOptions = useMemo(() => {
    return employees.filter(
      (emp) => emp.role === "technician" || emp.role === "admin"
    );
  }, [employees]);

  // Fetch purchase orders if switch is enabled and project is selected
  useEffect(() => {
    const fetchPurchaseOrders = async () => {
      if (!linkPurchaseOrders || !project) {
        setPurchaseOrders([]);
        return;
      }
      setLoadingPurchaseOrders(true);

      try {
        const q = query(
          collection(firestore, "orders").withConverter(purchaseOrderConverter),
          where("project-doc-id", "==", project.docId)
        );
        const snap = await getDocs(q);
        const orders: PurchaseOrder[] = [];
        snap.forEach((doc) => orders.push(doc.data()));
        setPurchaseOrders(orders);
      } catch (err) {
        console.error("Error fetching purchase orders:", err);
        toast.error("Failed to fetch purchase orders");
      } finally {
        setLoadingPurchaseOrders(false);
      }
    };

    fetchPurchaseOrders();
  }, [linkPurchaseOrders, project]);

  // Listen for number of project reports for this project and set docId for new reports
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (project && isNewReport) {
      const q = fsQuery(
        collection(firestore, "project reports"),
        fsWhere("project-doc-id", "==", project.docId)
      );
      unsubscribe = onSnapshot(q, (snap) => {
        setDocId(snap.size + 1);
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [project, isNewReport]);

  // Helper to combine materials and purchase order descriptions
  function combineMaterials(
    materials: string,
    purchaseOrders: PurchaseOrder[],
    link: boolean
  ): string {
    let poMaterials = "";
    if (link && purchaseOrders.length > 0) {
      poMaterials = purchaseOrders
        .map((po) => po.description?.trim())
        .filter(Boolean)
        .join("; ");
    }
    const allMaterials = [materials?.trim(), poMaterials]
      .filter(Boolean)
      .join("; ");
    return allMaterials.length > 0 ? allMaterials : "None";
  }

  const handleSaveDraft = async () => {
    setIsSaving(true);
    if (!user) {
      toast.error("You must be logged in to save a draft.");
      setIsSaving(false);
      return;
    }

    if (!project) {
      toast.error("Project is required.");
      setIsSaving(false);
      return;
    }
    
    const formData = getValues();
    
    try {
      if (isNewReport) {
        const newReport: ProjectReport = {
          id: crypto.randomUUID(),
          projectDocId: project.docId,
          docId,
          clientName: project.client,
          location: project.location,
          description: project.description,
          notes: formData.notes,
          materials: combineMaterials(
            formData.additionalMaterials,
            purchaseOrders,
            formData.linkPurchaseOrders
          ),
          draft: true,
          createdAt: Timestamp.now(),
          authorTechnicianRef: doc(
            firestore,
            "employees",
            authorTechnician.id
          ),
          leadTechnicianRef: leadEmployee
            ? doc(firestore, "employees", leadEmployee.id)
            : null,
          assignedTechniciansRef: assignedTechnicians.map((e) =>
            doc(firestore, "employees", e.id)
          ),
        };

        const docRef = await addDoc(
          collection(firestore, "project reports").withConverter(projectReportConverter),
          newReport
        );

        window.location.href = `/dashboard/project-reports/${docRef.id}/edit`;
      } else {
        if (!projectReport?.id) {
          throw new Error("Project report ID is missing for update.");
        }
        const docRef = doc(
          firestore,
          "project reports",
          projectReport.id
        ).withConverter(projectReportConverter);

        const updatedReport: ProjectReport = {
          assignedTechniciansRef: assignedTechnicians.map((e) =>
            doc(firestore, "employees", e.id)
          ),
          authorTechnicianRef: doc(
            firestore,
            "employees",
            authorTechnician.id
          ),
          clientName: project.client,
          createdAt: projectReport!.createdAt,
          description: project.description,
          docId: projectReport!.docId,
          draft: true,
          id: projectReport?.id || crypto.randomUUID(),
          leadTechnicianRef: leadEmployee
            ? doc(firestore, "employees", leadEmployee.id)
            : null,
          location: project.location,
          materials: formData.additionalMaterials,
          notes: formData.notes,
          projectDocId: project.docId,
        };
        await setDoc(docRef, updatedReport, { merge: true });
        toast.success(
          <span className="text-lg md:text-sm">Draft saved successfully!</span>
        );
      }
    } catch (error) {
      console.error("Error saving draft:", error);
      toast.error("Error saving draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (data: ProjectReportFormValues) => {
    setIsSubmitting(true);
    if (!user) {
      toast.error("You must be logged in to submit a project report.");
      setIsSubmitting(false);
      return;
    }
    if (!project) {
      toast.error("Project is required.");
      setIsSubmitting(false);
      return;
    }
    try {
      const currentDoc = docId;
      let newReportId = projectReport?.id || null;
      if (isNewReport) {
        const newReport: ProjectReport = {
          id: crypto.randomUUID(),
          projectDocId: project.docId,
          docId: currentDoc,
          clientName: project.client,
          location: project.location,
          description: project.description,
          notes: data.notes,
          materials: data.additionalMaterials,
          draft: false, // Set to false for submission
          createdAt: Timestamp.now(),
          authorTechnicianRef: doc(
            firestore,
            "employees",
            authorTechnician.id
          ),
          leadTechnicianRef: leadEmployee
            ? doc(firestore, "employees", leadEmployee.id)
            : null,
          assignedTechniciansRef: assignedTechnicians.map((e) =>
            doc(firestore, "employees", e.id)
          ),
        };
        const ref = await addDoc(
          collection(firestore, "reports").withConverter(projectReportConverter),
          newReport
        );
        newReportId = ref.id;
        setIsNewReport(false);
      } else {
        if (!projectReport?.id) {
          throw new Error("Project report ID is missing for update.");
        }
        const reportRef = doc(
          firestore,
          "project reports",
          projectReport.id
        ).withConverter(projectReportConverter);

        newReportId = projectReport.id;

        const newProjectReport: ProjectReport = {
          assignedTechniciansRef: assignedTechnicians.map((e) =>
            doc(firestore, "employees", e.id)
          ),
          authorTechnicianRef: doc(
            firestore,
            "employees",
            authorTechnician.id
          ),
          clientName: project.client,
          createdAt: projectReport!.createdAt,
          description: project.description,
          docId: currentDoc,
          draft: false, // Set to false for submission
          id: newReportId,
          leadTechnicianRef: leadEmployee
            ? doc(firestore, "employees", leadEmployee.id)
            : null,
          location: project.location,
          materials: data.additionalMaterials || "None",
          notes: data.notes,
          projectDocId: project.docId,
        };
        await setDoc(reportRef, newProjectReport!);
      }

      const message: ProjectReportMessage = {
        project_id: project.docId,
        doc_id: currentDoc,
        client_name: project.client,
        location: project.location,
        description: project.description,
        notes: data.notes || "None",
        materials: combineMaterials(
          data.additionalMaterials,
          purchaseOrders,
          data.linkPurchaseOrders
        ),
        date: new Date().toLocaleDateString("en-US"),
        project_subtitle: `PR ${project.docId} - ${currentDoc} - ${project.location}`,
        technician_email: authorTechnician.email!,
        technician_name: authorTechnician.name!,
        technician_phone: authorTechnician.phone!,
      };

      // Send report to API (v2)
      const currentEmployee = await getEmployeeByEmail(user.email!);
      const token = btoa(
        `${currentEmployee.clientId}:${currentEmployee.clientSecret}`
      );
      const authorizationHeader = `Bearer ${token}`;
      const res = await fetch("/api/mail/pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });
      const raw = await res.text();
      let result: { message?: string } = {};
      if (raw) {
        try {
          result = JSON.parse(raw) as { message?: string };
        } catch {
          result = {};
        }
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Mail API returned status ${res.status} instead of expected 2xx range. ${result.message ? `Response: ${result.message}` : ''}`);
      }
      toast.success("Report submitted successfully!");

      setSubmittedReportId(newReportId);
      setSubmitDialogOpen(true);
    } catch (error) {
      console.error("Error submitting report:", error);
      const errorMessage = error instanceof Error ? error.message : "Error submitting report";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRephrase = async () => {
    const currentNotes = getValues("notes");
    if (!currentNotes) return;
    setIsRephrasing(true);
    setRephraseDialogOpen(true);
    try {
      const response = await openAIClient.responses.create({
        model: "gpt-5-mini",
        instructions:
          "Rephrase the project report notes to sound casual yet professional and clear.",
        input: currentNotes,
      });
      setRephrase(response.output_text ?? "");
    } catch (error) {
      console.error("Error rephrasing notes:", error);
      toast.error("Failed to rephrase notes.");
    } finally {
      setIsRephrasing(false);
    }
  };

  const handleRephraseConfirm = () => {
    if (rephrase) {
      setValue("notes", rephrase);
      toast.success("Notes rephrased successfully!");
    }
    setRephrase(null);
    setRephraseDialogOpen(false);
  };

  // Form is always ready - page handles loading state and ensures all data is available

  // Preview handler: generate PDF preview
  const handlePreview = async () => {
    setIsPreviewing(true);
    if (!user || !project) {
      toast.error("User and project are required for preview.");
      setIsPreviewing(false);
      return;
    }
    try {
      const currentEmployee = await getEmployeeByEmail(user.email!);
      const token = btoa(
        `${currentEmployee.clientId}:${currentEmployee.clientSecret}`
      );
      const authorizationHeader = `Bearer ${token}`;
      const dateStr = new Date().toLocaleDateString("en-US");
      const formData = getValues();
      const message: ProjectReportPDFMessage = {
        project_no: project.docId,
        doc_id: docId,
        project_subtitle: `PR ${project.docId} - ${docId} - ${project.location}`,
        date: dateStr,
        client_name: project.client,
        location: project.location,
        materials: combineMaterials(
          formData.additionalMaterials,
          purchaseOrders,
          formData.linkPurchaseOrders
        ),
        notes: formData.notes || "None",
        technician_name: authorTechnician.name,
        technician_phone: authorTechnician.phone,
      };
      const res = await fetch("/api/pdf/pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });
      const responseData = await res.json();
      if (!res.ok) throw new Error(responseData.message || "Error generating preview");
      window.open(responseData.url, "_blank");
      toast.success("Preview generated successfully");
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Failed to generate preview");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleCloseDialog = () => {
    window.location.href = `/dashboard/project-reports/${submittedReportId!}`;
  };

  // Disable form interactions during submit/save/preview, but don't show skeleton
  // Page handles loading state

  return (
    <>
      {/* AI Rephrase Dialog */}
      <Dialog open={rephraseDialogOpen} onOpenChange={setRephraseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rephrase</DialogTitle>
          </DialogHeader>
          {isRephrasing ? (
            <div className="flex items-center justify-center">
              <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
              <span className="ml-2">Rephrasing...</span>
            </div>
          ) : (
            <Textarea value={rephrase ?? ""} readOnly rows={4} />
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                handleRephraseConfirm();
                setRephraseDialogOpen(false);
              }}
              disabled={!rephrase}
            >
              Confirm
            </Button>
            <Button
              variant="outline"
              onClick={() => setRephraseDialogOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Submit Success Dialog */}
      {project && (
        <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{project.docId} - {docId} Report Submitted</DialogTitle>
            </DialogHeader>
            <div className="py-4">Your project report was submitted successfully.</div>
            <DialogFooter>
              <Button
                onClick={handleCloseDialog}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="mt-4 flex flex-col gap-6 mb-8">
            <FormField
              control={form.control}
              name="projectDocId"
              render={() => (
                <FormItem className="flex flex-col space-y-2">
                  <FormLabel htmlFor="project">Project *</FormLabel>
                  <FormControl>
                    <ProjectSelect
                      selectedProject={project}
                      setSelectedProject={setProject}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {project && docId !== null && docId !== 0 && (
              <div className="flex flex-col space-y-2">
                <Label htmlFor="docId">Report No.</Label>
                <Input
                  id="docId"
                  type="text"
                  className="w-full md:max-w-96"
                  value={docId.toString()}
                  readOnly
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="leadTechnicianId"
              render={() => (
                <FormItem className="flex flex-col space-y-2">
                  <FormLabel htmlFor="leadTechnician">Lead Technician</FormLabel>
                  <FormControl>
                    <EmployeeSelect
                      employees={leadTechnicianOptions}
                      loading={loadingEmployees}
                      error={employeesError}
                      refetch={refetchEmployees}
                      selectedEmployee={leadEmployee}
                      setSelectedEmployee={(emp) => {
                        setLeadEmployee(emp);
                        setValue("leadTechnicianId", emp?.id || null);
                      }}
                      placeholder="Select Lead Technician..."
                    />
                  </FormControl>
                  <p className="text-base sm:text-sm text-muted-foreground mb-1">
                    Leave blank if you are the lead technician.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="assignedTechnicianIds"
              render={() => (
                <FormItem className="flex flex-col space-y-2">
                  <FormLabel htmlFor="assignedTechnicians">Assigned Technicians</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {assignedTechnicians.map((emp) => (
                      <span
                        key={emp.id}
                        className="flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                      >
                        {emp.name}
                        <button
                          type="button"
                          onClick={() => handleRemoveTechnician(emp.id)}
                          className="ml-1 text-blue-500 hover:text-blue-800"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                  <FormControl>
                    <EmployeeSelect
                      employees={technicians.filter(
                        (emp) => !assignedTechnicians.some((assigned) => assigned.id === emp.id)
                      )}
                      loading={loadingEmployees}
                      error={employeesError}
                      refetch={refetchEmployees}
                      selectedEmployee={null}
                      setSelectedEmployee={(empl) => {
                        handleAddTechnician(empl as EmployeeModel);
                      }}
                      placeholder="Add Technician..."
                    />
                  </FormControl>
                  <p className="text-base sm:text-sm text-muted-foreground mb-1">
                    Optional. Add other technicians who worked on this project.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="flex flex-col space-y-2">
                  <FormLabel htmlFor="notes">Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      id="notes"
                      {...field}
                      rows={5}
                      className="block w-full border rounded px-2 py-1"
                      placeholder="Enter notes here"
                    />
                  </FormControl>
                  <div className="flex items-center justify-end mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isRephrasing || !field.value}
                      onClick={handleRephrase}
                    >
                      {isRephrasing ? "Rephrasing..." : "Rephrase"}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Purchase Orders Switch and List (moved below Notes) */}
            <FormField
              control={form.control}
              name="linkPurchaseOrders"
              render={({ field }) => (
                <FormItem className="flex flex-col space-y-2">
                  <div className="flex items-center gap-2 mt-2">
                    <FormLabel htmlFor="linkPurchaseOrders">Link Purchase Orders</FormLabel>
                    <FormControl>
                      <Switch
                        id="linkPurchaseOrders"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!project}
                      />
                    </FormControl>
                    <p className="text-base sm:text-sm">
                      {field.value ? "On" : "Off"}
                    </p>
                    {loadingPurchaseOrders && (
                      <Loader2 className="animate-spin h-4 w-4 ml-2 text-muted-foreground" />
                    )}
                  </div>
                  {field.value && !loadingPurchaseOrders && (
                    <div className="mt-2 border rounded-lg p-4 bg-muted/30">
                      {purchaseOrders.length === 0 ? (
                        <div className="text-muted-foreground text-sm">
                          No purchase orders found for this report.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {purchaseOrders.map((po) => (
                            <div key={po.id} className="flex flex-col space-y-1">
                              <div className="sm:text-sm text-base">
                                PO {po.docId} - {po.description}
                              </div>
                              {/* If you want to show more PO fields, add them here as readOnly or plain text */}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="additionalMaterials"
              render={({ field }) => (
                <FormItem className="flex flex-col space-y-2">
                  <FormLabel htmlFor="additionalMaterials">Additional Materials</FormLabel>
                  <FormControl>
                    <Textarea
                      id="additionalMaterials"
                      {...field}
                      rows={5}
                      className="block w-full border rounded px-2 py-1 mt-1"
                      placeholder="Optional materials used"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Action buttons */}
            <div className="mt-8 mb-8">
            {/* Preview button on its own line */}
            <div className="mb-4">
              <Button
                type="button"
                disabled={isPreviewing || isSaving || isSubmitting || !project}
                variant="outline"
                onClick={handlePreview}
              >
                {isPreviewing ? "Previewing..." : "Preview"}
              </Button>
            </div>
            {/* Save and Submit buttons on same line */}
            <div className="flex gap-4">
              <Button
                type="button"
                disabled={isSaving || isPreviewing || isSubmitting || !project}
                variant="outline"
                onClick={handleSaveDraft}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isSaving || isPreviewing || !project}
                variant="default"
              >
                {isSubmitting ? "Submitting..." : "Submit"}
              </Button>
            </div>
          </div>
        </div>
        </form>
      </Form>
    </>
  );
}
