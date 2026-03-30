"use client";

import openAIClient from "@/lib/openai";
import { useState, useEffect } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import EmployeeSelect from "@/components/EmployeeSelect";
import { Employee, employeeConverter } from "@/models/Employee";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useEmployees } from "@/hooks/useEmployees";
import { ServiceReport, serviceReportConverter } from "@/models/ServiceReport";
import {
  addDoc,
  arrayUnion,
  DocumentData,
  getDoc,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import ClientSelect from "./ClientSelect";
import { Building, ClientHit } from "@/models/Client";
import { toast } from "sonner";
import TimeSelect from "@/components/TimeSelect";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// ShadCN Select imports:
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reserveDocid } from "@/services/reportService";
import {
  ServiceReportPDFMessage,
  ServiceReportMessage,
} from "@/models/ServiceReport";
import { getEmployeeByEmail } from "@/services/employeeService";
import { buildAppliedBasAuthorizationHeader } from "@/lib/services";
import { PurchaseOrder, purchaseOrderConverter } from "@/models/PurchaseOrder";

interface ServiceReportFormProps {
  serviceReport?: ServiceReport;
  authorTechnician: Employee;
}

// Zod schema for service note
const serviceNoteSchema = z.object({
  date: z.date(),
  technicianTime: z.string(),
  technicianOvertime: z.string(),
  helperTime: z.string(),
  helperOvertime: z.string(),
  remoteWork: z.enum(["Y", "N"]),
  notes: z.string().min(1, "Service notes are required"),
});

// Zod schema for the form
const serviceReportFormSchema = z.object({
  dispatcherId: z.string().nullable().optional(),
  assignedTechnicianId: z.string().nullable().optional(),
  clientId: z.string().min(1, "Client is required"),
  buildingServiceAddress1: z.string().min(1, "Building is required"),
  warranty: z.boolean(),
  linkPurchaseOrders: z.boolean(),
  materialNotes: z.string(),
  serviceNotes: z.array(serviceNoteSchema).min(1, "At least one service note is required"),
  emails: z.array(z.string().email("Invalid email address").or(z.literal(""))),
}).refine((data) => {
  return data.serviceNotes.some((note) => {
    const techTime = parseFloat(note.technicianTime) || 0;
    const helperTime = parseFloat(note.helperTime) || 0;
    const techOt = parseFloat(note.technicianOvertime) || 0;
    const helperOt = parseFloat(note.helperOvertime) || 0;
    return (
      techTime > 0 ||
      helperTime > 0 ||
      techOt > 0 ||
      helperOt > 0
    );
  });
}, {
  message:
    "Fill in hours for either normal time or overtime in at least one service note.",
  path: ["serviceNotes"],
});

type ServiceReportFormValues = z.infer<typeof serviceReportFormSchema>;

export default function ServiceReportForm({
  serviceReport,
  authorTechnician: initialAuthorTechnician,
}: ServiceReportFormProps) {
  const {
    employees,
    technicians,
    loading: loadingEmployees,
    error: employeesError,
    refetch: refetchEmployees,
  } = useEmployees();

  const { user } = useAuth();
  const [authorTechnician] = useState<Employee>(initialAuthorTechnician);
  
  // UI state (not form data)
  const [rephraseDialogOpen, setRephraseDialogOpen] = useState(false);
  const [currentRephraseIndex, setCurrentRephraseIndex] = useState<number | null>(null);
  const [rephrase, setRephrase] = useState<string | null>(null);
  const [isRephrasing, setIsRephrasing] = useState<boolean>(false);
  const [isNewReport, setIsNewReport] = useState<boolean>(!serviceReport);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [addBuildingOpen, setAddBuildingOpen] = useState(false);
  const [loadingPOs, setLoadingPOs] = useState(false);
  
  // External data state (not form data)
  const [docId, setDocId] = useState<number | null>(serviceReport?.docId || 0);
  const [client, setClient] = useState<ClientHit | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [assignedTechnician, setAssignedTechnician] = useState<Employee | null>(null);
  const [dispatcher, setDispatcher] = useState<Employee | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [newBuilding, setNewBuilding] = useState({
    serviceAddress1: "",
    serviceAddress2: "",
    cityStateZip: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  });

  // Filter employees to only show admins for dispatcher selection
  const adminEmployees = employees.filter((emp) => emp.role === "admin");

  // Initialize form with react-hook-form
  const form = useForm<ServiceReportFormValues>({
    resolver: zodResolver(serviceReportFormSchema),
    defaultValues: {
      dispatcherId: null,
      assignedTechnicianId: null,
      clientId: "",
      buildingServiceAddress1: "",
      warranty: serviceReport?.warranty || false,
      linkPurchaseOrders: false,
      materialNotes: serviceReport?.materialNotes || "",
      serviceNotes: serviceReport?.serviceNotes.map((sn) => ({
        date: sn.date.toDate(),
        technicianTime: sn.technicianTime,
        technicianOvertime: sn.technicianOvertime,
        helperTime: sn.helperTime,
        helperOvertime: sn.helperOvertime,
        remoteWork: sn.remoteWork as "Y" | "N",
        notes: sn.serviceNotes,
      })) || [
        {
          date: new Date(),
          technicianTime: "0.0",
          technicianOvertime: "0.0",
          helperTime: "0.0",
          helperOvertime: "0.0",
          remoteWork: "N" as const,
          notes: "",
        },
      ],
      emails: [],
    },
  });

  const { watch, setValue, getValues } = form;
  const warranty = watch("warranty");
  const linkPurchaseOrders = watch("linkPurchaseOrders");
  const serviceNotes = watch("serviceNotes");
  const emails = watch("emails");

  useEffect(() => {
    async function fetchPurchaseOrders() {
      if (!docId) return;
      setLoadingPOs(true);
      try {
        const q = query(
          collection(firestore, "orders").withConverter(purchaseOrderConverter),
          where("service-report-doc-id", "==", docId)
        );
        const querySnapshot = await getDocs(q);
        const orders: PurchaseOrder[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data) {
            orders.push(data);
          }
        });
        setPurchaseOrders(orders);
      } catch (err) {
        setPurchaseOrders([]);
        console.error("Error fetching purchase orders:", err);
      } finally {
        setLoadingPOs(false);
      }
    }
    if (linkPurchaseOrders) fetchPurchaseOrders();
  }, [linkPurchaseOrders, docId]);

  // Initialize form data from serviceReport
  useEffect(() => {
    async function initForm() {
      if (!serviceReport) return;

      if (serviceReport.assignedTechnicianRef) {
        const empRef =
          serviceReport.assignedTechnicianRef.withConverter(employeeConverter);
        const empSnap = await getDoc(empRef);
        if (empSnap.exists()) {
          const emp = empSnap.data() as Employee;
          setAssignedTechnician(emp);
          setValue("assignedTechnicianId", emp.id);
        }
      }

      if (serviceReport.dispatcherRef) {
        const empRef =
          serviceReport.dispatcherRef.withConverter(employeeConverter);
        const empSnap = await getDoc(empRef);
        if (empSnap.exists()) {
          const emp = empSnap.data() as Employee;
          setDispatcher(emp);
          setValue("dispatcherId", emp.id);
        }
      }

      // Populate client from serviceReport.clientName if available
      if (serviceReport.clientName) {
        const q = query(
          collection(firestore, "clients"),
          where("name", "==", serviceReport.clientName)
        );

        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const docSnap = querySnapshot.docs[0];
          const data = docSnap.data();
          const clientHit: ClientHit = {
            objectID: docSnap.id,
            clientName: data["name"],
            buildings: Array.isArray(data.buildings)
              ? data.buildings.map((bld: DocumentData) => ({
                  serviceAddress1: bld["service-address1"],
                  serviceAddress2: bld["service-address2"],
                  cityStateZip: bld["city-state-zip"],
                  contactName: bld["contact-name"],
                  contactEmail: bld["contact-email"],
                  contactPhone: bld["contact-phone"],
                }))
              : [],
          };
          setClient(clientHit);
          setValue("clientId", clientHit.objectID);
          
          // Set building if possible
          const foundBuilding = clientHit.buildings.find(
            (bld) => bld.serviceAddress1 === serviceReport.serviceAddress1
          );
          if (foundBuilding) {
            setBuilding(foundBuilding);
            setValue("buildingServiceAddress1", foundBuilding.serviceAddress1);
            setValue("emails", [foundBuilding.contactEmail]);
          }
        }
      }
    }
    initForm();
  }, [serviceReport, setValue]);

  // Track original contact info for change detection
  const [originalContact, setOriginalContact] = useState({
    contactName: serviceReport?.contactName || "",
    contactEmail: serviceReport?.contactEmail || "",
    contactPhone: serviceReport?.contactPhone || "",
  });

  // Detect if contact info has changed
  const contactChanged =
    building?.contactName !== originalContact.contactName ||
    building?.contactEmail !== originalContact.contactEmail ||
    building?.contactPhone !== originalContact.contactPhone;

  // Handler for saving contact info to Firestore (Building)
  const handleSaveContact = async () => {
    if (!client || !building) return;
    try {
      // Find the building in the client's buildings array and update its contact info
      const clientRef = doc(firestore, "clients", client.objectID);
      const updatedBuildings = client.buildings.map((bld) => {
        if (
          bld.serviceAddress1 === building.serviceAddress1 &&
          bld.serviceAddress2 === building.serviceAddress2
        ) {
          return {
            "service-address1": building.serviceAddress1,
            "service-address2": building.serviceAddress2,
            "city-state-zip": building.cityStateZip,
            "contact-name": building.contactName,
            "contact-email": building.contactEmail,
            "contact-phone": building.contactPhone,
          };
        }
        return {
          "service-address1": bld.serviceAddress1,
          "service-address2": bld.serviceAddress2,
          "city-state-zip": bld.cityStateZip,
          "contact-name": bld.contactName,
          "contact-email": bld.contactEmail,
          "contact-phone": bld.contactPhone,
        };
      });
      await updateDoc(clientRef, { buildings: updatedBuildings });
      setOriginalContact({
        contactName: building.contactName,
        contactEmail: building.contactEmail,
        contactPhone: building.contactPhone,
      });
      toast.success(
        <span className="text-lg md:text-sm">Contact information saved!</span>
      );
    } catch {
      toast.error(
        <span className="text-lg md:text-sm">Failed to save contact info.</span>
      );
    }
  };

  const handleWarrantyChange = (checked: boolean) => {
    setValue("warranty", checked);
    if (checked) {
      // remove building contact info when warranty is checked
      setValue("emails", []);
    } else {
      // restore building contact info when warranty is unchecked
      if (building) {
        setValue("emails", [building.contactEmail]);
      }
    }
  };

  const handleRephrase = async (index: number) => {
    if (!user) {
      toast.error(
        <span className="text-lg md:text-sm">
          You must be logged in to rephrase service notes.
        </span>
      );
      return;
    }

    setIsRephrasing(true);
    try {
      setCurrentRephraseIndex(index);
      setRephraseDialogOpen(true);
      const currentNotes = getValues("serviceNotes");
      const noteToRephrase = currentNotes[index]?.notes;
      if (!noteToRephrase) {
        toast.error(
          <span className="text-lg md:text-sm">
            No service note text to rephrase.
          </span>
        );
        return;
      }
      const response = await openAIClient.responses.create({
        model: "gpt-5-mini",
        instructions:
          "Rephrase the service note to sound casual yet professional and clear.",
        input: noteToRephrase,
      });

      setRephrase(response.output_text ?? null);
    } catch (error) {
      console.error("Error rephrasing service note:", error);
      toast.error(
        <span className="text-lg md:text-sm">
          Failed to rephrase service note. Please try again later.
        </span>
      );
    } finally {
      setIsRephrasing(false);
    }
  };

  const handleRephraseConfirm = (index: number) => {
    if (rephrase && currentRephraseIndex !== null) {
      const currentNotes = getValues("serviceNotes");
      const updatedNotes = currentNotes.map((note, i) =>
        i === index ? { ...note, notes: rephrase } : note
      );
      setValue("serviceNotes", updatedNotes);
      setRephrase(null);
      toast.success(
        <span className="text-lg md:text-sm">
          Service note rephrased successfully!
        </span>
      );
    } else {
      toast.error(
        <span className="text-lg md:text-sm">No rephrased text available.</span>
      );
    }
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);

    if (!user) {
      setIsSaving(false);
      return;
    }

    const formData = getValues();
    
    if (!client) {
      toast.error(
        <span className="text-lg md:text-sm">
          Please select a client before saving the draft.
        </span>
      );
      setIsSaving(false);
      return;
    }

    if (!building) {
      toast.error(
        <span className="text-lg md:text-sm">
          Please select a building before saving the draft.
        </span>
      );
      setIsSaving(false);
      return;
    }

    if (formData.serviceNotes.length === 0) {
      toast.error(
        <span className="text-lg md:text-sm">
          Please add at least one service note before saving the draft.
        </span>
      );
      setIsSaving(false);
      return;
    }

    try {
      // Create a new service report object
      if (isNewReport) {
        // get new id
        const newDocId = await reserveDocid();
        // create new document reference
        const newServiceReport: ServiceReport = {
          id: crypto.randomUUID(),
          docId: newDocId,
          authorTechnicianRef: doc(
            firestore,
            "employees",
            authorTechnician.id
          ),
          assignedTechnicianRef: assignedTechnician
            ? doc(firestore, "employees", assignedTechnician.id)
            : null,
          dispatcherRef: dispatcher
            ? doc(firestore, "employees", dispatcher.id)
            : null,
          clientName: client.clientName,
          serviceAddress1: building.serviceAddress1,
          serviceAddress2: building.serviceAddress2,
          cityStateZip: building.cityStateZip,
          contactName: building.contactName,
          contactEmail: building.contactEmail,
          contactPhone: building.contactPhone,
          materialNotes: formData.materialNotes,
          serviceNotes: formData.serviceNotes.map((note) => ({
            date: Timestamp.fromDate(note.date),
            technicianTime: note.technicianTime,
            technicianOvertime: note.technicianOvertime,
            helperTime: note.helperTime,
            helperOvertime: note.helperOvertime,
            remoteWork: note.remoteWork,
            serviceNotes: note.notes,
          })),
          createdAt: Timestamp.now(),
          dateSigned: null,
          draft: true,
          printedName: "",
          warranty: formData.warranty,
        };

        // create new document reference
        const docRef = await addDoc(
          collection(firestore, "reports").withConverter(
            serviceReportConverter
          ),
          newServiceReport
        );
        setDocId(newDocId);

        window.location.href = `/dashboard/service-reports/${docRef.id}/edit`;
      } else {
        // use existing serviceReport.id
        const serviceReportRef = doc(
          firestore,
          "reports",
          serviceReport!.id
        ).withConverter(serviceReportConverter);
        // update existing document
        const serviceReportData: ServiceReport = {
          id: serviceReport!.id,
          docId: serviceReport!.docId,
          createdAt: serviceReport!.createdAt,
          dateSigned: null,
          draft: true,
          printedName: serviceReport?.printedName || "",
          authorTechnicianRef: serviceReport!.authorTechnicianRef,
          assignedTechnicianRef: assignedTechnician
            ? doc(firestore, "employees", assignedTechnician.id)
            : null,
          dispatcherRef: dispatcher
            ? doc(firestore, "employees", dispatcher.id)
            : null,
          clientName: client.clientName,
          serviceAddress1: building.serviceAddress1,
          serviceAddress2: building.serviceAddress2,
          cityStateZip: building.cityStateZip,
          contactName: building.contactName,
          contactEmail: building.contactEmail,
          contactPhone: building.contactPhone,
          materialNotes: formData.materialNotes,
          serviceNotes: formData.serviceNotes.map((note) => ({
            date: Timestamp.fromDate(note.date),
            technicianTime: note.technicianTime,
            technicianOvertime: note.technicianOvertime,
            helperTime: note.helperTime,
            helperOvertime: note.helperOvertime,
            remoteWork: note.remoteWork,
            serviceNotes: note.notes,
          })),
          warranty: formData.warranty,
        };

        await setDoc(serviceReportRef, serviceReportData);
      }
      toast.success(
        <span className="text-lg md:text-sm">Draft saved successfully!</span>
      );
    } catch (error) {
      console.error("Error saving draft:", error);
      toast.error(
        <span className="text-lg md:text-sm">
          Failed to save draft. Please try again.
        </span>
      );
    } finally {
      setIsSaving(false);
    }
  };

  // New: cancel unsaved contact edits
  const handleCancelContact = () => {
    setBuilding((prev) =>
      prev
        ? {
            ...prev,
            contactName: originalContact.contactName,
            contactEmail: originalContact.contactEmail,
            contactPhone: originalContact.contactPhone,
          }
        : null
    );
  };

  const handleAddServiceNote = () => {
    const currentNotes = getValues("serviceNotes");
    setValue("serviceNotes", [
      ...currentNotes,
      {
        date: new Date(),
        technicianTime: "0.0",
        technicianOvertime: "0.0",
        helperTime: "0.0",
        helperOvertime: "0.0",
        remoteWork: "N" as const,
        notes: "",
      },
    ]);
  };

  const handleRemoveServiceNote = (index: number) => {
    const currentNotes = getValues("serviceNotes");
    setValue("serviceNotes", currentNotes.filter((_, i) => i !== index));
  };

  // Helper to combine additional materials with PO materials for preview/submit
  function getCombinedMaterials() {
    const materialNotes = getValues("materialNotes");
    let combined = materialNotes?.trim() || "";
    if (linkPurchaseOrders && purchaseOrders.length > 0) {
      const poMaterials = purchaseOrders
        .map((po) =>
          po.description
        ? `PO ${po.docId} - ${po.description}`
        : `PO ${po.docId}`
        )
        .join("\n");
      if (poMaterials) {
        combined = combined ? `${combined}; ${poMaterials}` : poMaterials;
      }
    }
    return combined && combined.trim() !== "" ? combined : "None";
  }

  // Helper to get all unique emails from dispatcher, assigned technician, and author technician
  function getTechnicianEmails(): string[] {
    const technicianEmails: string[] = [];
    if (dispatcher?.email) technicianEmails.push(dispatcher.email);
    if (assignedTechnician?.email) technicianEmails.push(assignedTechnician.email);
    if (authorTechnician.email) technicianEmails.push(authorTechnician.email);
    // Remove duplicates
    return [...new Set(technicianEmails)];
  }

  // Helper to get all unique emails (technician emails + manual emails)
  function getAllUniqueEmails(): string[] {
    const technicianEmails = getTechnicianEmails();
    const formEmails = getValues("emails");
    const allEmails = [...technicianEmails, ...formEmails];
    // Remove duplicates and empty strings
    return [...new Set(allEmails.filter(email => email && email.trim() !== ""))];
  }

  const handleSubmit = async (data: ServiceReportFormValues) => {
    setIsSubmitting(true);

    if (contactChanged) {
      toast.error(
        <span className="text-lg md:text-sm">
          Please save the contact information changes before submitting.
        </span>
      );
      setIsSubmitting(false);
      return;
    }

    if (!user) {
      toast.error(
        <span className="text-lg md:text-sm">
          You must be logged in to submit a service report.
        </span>
      );
      setIsSubmitting(false);
      return;
    }

    if (!client || !building) {
      toast.error(
        <span className="text-lg md:text-sm">
          Client and building must be selected before sending.
        </span>
      );
      setIsSubmitting(false);
      return;
    }

    if (!dispatcher) {
      toast.error(
        <span className="text-lg md:text-sm">
          Please select a dispatcher before submitting.
        </span>
      );
      setIsSubmitting(false);
      return;
    }

    // Reserve or use existing docId
    let currentDocId = docId;
    let id = serviceReport?.id;
    if (isNewReport) {
      currentDocId = await reserveDocid();
      setDocId(currentDocId);
      // Create new ServiceReport in Firestore
      const newReport: ServiceReport = {
        id: crypto.randomUUID(),
        docId: currentDocId!,
        authorTechnicianRef: doc(firestore, "employees", authorTechnician.id),
        assignedTechnicianRef: assignedTechnician
          ? doc(firestore, "employees", assignedTechnician.id)
          : null,
        dispatcherRef: dispatcher
          ? doc(firestore, "employees", dispatcher.id)
          : null,
        clientName: client.clientName,
        serviceAddress1: building.serviceAddress1,
        serviceAddress2: building.serviceAddress2,
        cityStateZip: building.cityStateZip,
        contactName: building.contactName,
        contactEmail: building.contactEmail,
        contactPhone: building.contactPhone,
        materialNotes: data.materialNotes,
        serviceNotes: data.serviceNotes.map((n) => ({
          date: Timestamp.fromDate(n.date),
          technicianTime: n.technicianTime,
          technicianOvertime: n.technicianOvertime,
          helperTime: n.helperTime,
          helperOvertime: n.helperOvertime,
          remoteWork: n.remoteWork,
          serviceNotes: n.notes,
        })),
        createdAt: Timestamp.now(),
        dateSigned: null,
        draft: false,
        printedName: "",
        warranty: data.warranty,
      };
      const ref = await addDoc(
        collection(firestore, "reports").withConverter(serviceReportConverter),
        newReport
      );
      id = ref.id;
      setIsNewReport(false);
    } else {
      // Update existing report if needed
      const reportRef = doc(
        firestore,
        "reports",
        serviceReport!.id
      ).withConverter(serviceReportConverter);
      id = serviceReport!.id;
      await setDoc(reportRef, {
        ...serviceReport!,
        dispatcherRef: dispatcher
          ? doc(firestore, "employees", dispatcher.id)
          : null,
        serviceNotes: data.serviceNotes.map((n) => ({
          date: Timestamp.fromDate(n.date),
          technicianTime: n.technicianTime,
          technicianOvertime: n.technicianOvertime,
          helperTime: n.helperTime,
          helperOvertime: n.helperOvertime,
          remoteWork: n.remoteWork,
          serviceNotes: n.notes,
        })),
        draft: false,
        warranty: data.warranty,
      });
    }

    const currentEmployee: Employee = await getEmployeeByEmail(user.email!);
    let authorizationHeader: string;
    try {
      authorizationHeader = buildAppliedBasAuthorizationHeader(currentEmployee);
    } catch {
      toast.error(
        <span className="text-lg md:text-sm">
          Error loading employee API credentials. Check client-id and client-secret on your
          employee record, then try again.
        </span>
      );
      setIsSubmitting(false);
      return;
    }
    // Now build and send email via API
    const formatDate = (d: Date) => d.toLocaleDateString("en-US");
    const firstDate = data.serviceNotes[0].date;
    const lastDate = data.serviceNotes[data.serviceNotes.length - 1].date;
    
    // Determine which technician to use: assigned technician > dispatcher > author technician
    const technicianForReport = assignedTechnician || dispatcher || authorTechnician;
    
    const message: ServiceReportMessage = {
      report_no: currentDocId!,
      date: formatDate(new Date()),
      client_name: client.clientName,
      service_address:
        building.serviceAddress1 +
        (building.serviceAddress2 ? ` ${building.serviceAddress2}` : ""),
      city_state_zip: building.cityStateZip,
      contact_name: data.warranty
        ? `Warranty for ${building.contactName}`
        : building.contactName,
      contact_phone: building.contactPhone,
      contact_email: building.contactEmail,
      signature: null,
      t_time: data.serviceNotes.reduce(
        (sum, n) => sum + parseFloat(n.technicianTime),
        0
      ),
      t_ot: data.serviceNotes.reduce(
        (sum, n) => sum + parseFloat(n.technicianOvertime),
        0
      ),
      h_time: data.serviceNotes.reduce(
        (sum, n) => sum + parseFloat(n.helperTime),
        0
      ),
      h_ot: data.serviceNotes.reduce(
        (sum, n) => sum + parseFloat(n.helperOvertime),
        0
      ),
      materials: getCombinedMaterials(),
      notes: data.serviceNotes.map((n) => ({
        date: formatDate(n.date),
        t_time: parseFloat(n.technicianTime),
        t_ot: parseFloat(n.technicianOvertime),
        h_time: parseFloat(n.helperTime),
        h_ot: parseFloat(n.helperOvertime),
        remote: n.remoteWork,
        note: n.notes,
      })),
      technician_name: technicianForReport.name,
      technician_phone: technicianForReport.phone,
      technician_email: technicianForReport.email,
      print_name: null,
      sign_date: null,
      to_emails: getAllUniqueEmails(),
      start_date: formatDate(firstDate),
      end_date: formatDate(lastDate),
    };
    try {
      const res = await fetch("https://api.appliedbas.com/v2/mail/sr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });
      const responseData = await res.json();
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Mail API returned status ${res.status} instead of expected 2xx range. ${responseData.message ? `Response: ${responseData.message}` : ''}`);
      }
      toast.success(
        <span className="text-lg md:text-sm">
          Service report sent successfully!
        </span>
      );
      // Optionally, redirect to the report view page
      setSubmittedReportId(id);
      setSubmitDialogOpen(true);
 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to send service report. Please try again later.";
      toast.error(
        <span className="text-lg md:text-sm">
          {errorMessage}
        </span>
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNewBuildingChange = (field: string, value: string) => {
    setNewBuilding((prev) => ({ ...prev, [field]: value }));
  };

  // Helper to format US phone numbers as XXX-XXX-XXXX and strip non-digits
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handleAddBuilding = async (e: React.FormEvent) => {
    e.preventDefault();

    // Handle adding the new building
    const newBuildingData: DocumentData = {
      "service-address1": newBuilding.serviceAddress1,
      "service-address2": newBuilding.serviceAddress2,
      "city-state-zip": newBuilding.cityStateZip,
      "contact-name": newBuilding.contactName,
      "contact-email": newBuilding.contactEmail,
      "contact-phone": newBuilding.contactPhone,
    };

    const docRef = doc(firestore, "clients", client!.objectID);
    try {
      await updateDoc(docRef, {
        ["buildings"]: arrayUnion(newBuildingData),
      });
      toast.success(
        <span className="text-lg md:text-sm">Building added successfully!</span>
      );
    } catch (error) {
      console.error("Error adding building:", error);
      toast.error(
        <span className="text-lg md:text-sm">
          Failed to add building. Please try again later.
        </span>
      );
    }

    // Optionally, you could also update the client state to include this new building
    setClient((prev) => {
      if (!prev) return null;
      // Convert newBuildingData (Firestore field names) to Building type
      const newBuildingObj: Building = {
        serviceAddress1: newBuildingData["service-address1"],
        serviceAddress2: newBuildingData["service-address2"],
        cityStateZip: newBuildingData["city-state-zip"],
        contactName: newBuildingData["contact-name"],
        contactEmail: newBuildingData["contact-email"],
        contactPhone: newBuildingData["contact-phone"],
      };
      return {
        ...prev,
        buildings: [...(prev.buildings || []), newBuildingObj],
      };
    });

    // Reset the form
    setAddBuildingOpen(false);
    setNewBuilding({
      serviceAddress1: "",
      serviceAddress2: "",
      cityStateZip: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    });
  };

  // Generate PDF preview via API
  const handleGeneratePDF = async () => {
    setIsPreviewing(true);
    try {
      if (!user) {
        toast.error(
          <span className="text-lg md:text-sm">
            You must be logged in to generate a PDF
          </span>
        );
        return;
      }
      if (!client || !building) {
        toast.error(
          <span className="text-lg md:text-sm">
            Please select a client and building
          </span>
        );
        return;
      }
      const currentEmployee: Employee = await getEmployeeByEmail(user.email!);
      let authorizationHeader: string;
      try {
        authorizationHeader = buildAppliedBasAuthorizationHeader(currentEmployee);
      } catch {
        toast.error(
          <span className="text-lg md:text-sm">
            Error loading employee API credentials. Check client-id and client-secret on your
            employee record, then try again.
          </span>
        );
        return;
      }

      const formatDate = (d: Date) => d.toLocaleDateString("en-US");
      const formData = getValues();
      
      // Determine which technician to use: assigned technician > dispatcher > author technician
      const technicianForReport = assignedTechnician || dispatcher || authorTechnician;
      
      const message: ServiceReportPDFMessage = {
        report_no: docId || 0,
        date: formatDate(new Date()),
        client_name: client.clientName,
        service_address:
          building.serviceAddress1 +
          (building.serviceAddress2 ? ` ${building.serviceAddress2}` : ""),
        city_state_zip: building.cityStateZip,
        contact_name: building.contactName,
        contact_phone: building.contactPhone,
        contact_email: building.contactEmail,
        signature: null,
        t_time: formData.serviceNotes.reduce(
          (sum, n) => sum + parseFloat(n.technicianTime),
          0
        ),
        t_ot: formData.serviceNotes.reduce(
          (sum, n) => sum + parseFloat(n.technicianOvertime),
          0
        ),
        h_time: formData.serviceNotes.reduce(
          (sum, n) => sum + parseFloat(n.helperTime),
          0
        ),
        h_ot: formData.serviceNotes.reduce(
          (sum, n) => sum + parseFloat(n.helperOvertime),
          0
        ),
        materials: getCombinedMaterials(),
        notes: formData.serviceNotes.map((n) => ({
          date: formatDate(n.date),
          t_time: parseFloat(n.technicianTime),
          t_ot: parseFloat(n.technicianOvertime),
          h_time: parseFloat(n.helperTime),
          h_ot: parseFloat(n.helperOvertime),
          remote: n.remoteWork,
          note: n.notes,
        })),
        technician_name: technicianForReport.name,
        technician_phone: technicianForReport.phone,
        print_name: null,
        sign_date: null,
      };

      // Same-origin proxy avoids browser CORS / "Failed to fetch" to api.appliedbas.com
      const previewUrl = "/api/pdf/sr";
      const previewBody = JSON.stringify(message);
      console.log("[Service report PDF preview] request", {
        method: "POST",
        url: previewUrl,
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: message,
      });

      const res = await fetch(previewUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: previewBody,
      });

      const raw = await res.text();
      let responseData: { message?: string; url?: string; code?: number };
      try {
        responseData = raw ? (JSON.parse(raw) as typeof responseData) : {};
      } catch {
        throw new Error(
          `PDF preview response was not JSON (HTTP ${res.status}). Body: ${raw.slice(0, 200)}`
        );
      }

      if (!res.ok) {
        throw new Error(responseData.message || `Error generating PDF (HTTP ${res.status})`);
      }

      // Some APIs return HTTP 200 with an application-level error in the body.
      const code = responseData.code;
      if (
        typeof code === "number" &&
        code !== 0 &&
        code !== 200
      ) {
        throw new Error(
          responseData.message || `PDF API returned code ${code}`
        );
      }

      const pdfUrl = responseData.url?.trim();
      if (!pdfUrl) {
        throw new Error(
          responseData.message || "PDF preview response did not include a url."
        );
      }

      window.open(pdfUrl, "_blank");

      toast.success(
        <span className="text-lg md:text-sm">PDF generated and downloaded</span>
      );
    } catch (error) {
      console.error("Error generating PDF:", error);
      const detail =
        error instanceof Error ? error.message : "Error generating PDF. Save draft and try again later.";
      toast.error(<span className="text-lg md:text-sm">{detail}</span>);
    } finally {
      setIsPreviewing(false);
    }
  };

  function handleRemoveEmail(idx: number): void {
    const currentEmails = getValues("emails");
    setValue("emails", currentEmails.filter((_, index) => index !== idx));
  }

  function handleAddEmail(
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ): void {
    event.preventDefault();
    const currentEmails = getValues("emails");
    setValue("emails", [...currentEmails, ""]);
  }

  // Form is always ready - page handles loading state and ensures all data is available

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
                if (currentRephraseIndex !== null)
                  handleRephraseConfirm(currentRephraseIndex);
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
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Submitted</DialogTitle>
          </DialogHeader>
          <div className="py-4">Your service report was submitted successfully.</div>
          <DialogFooter>
            <Button
              onClick={() => {
                window.location.href = `/dashboard/service-reports/${submittedReportId}`;
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit, (errors: FieldErrors<ServiceReportFormValues>) => {
            const sn = errors.serviceNotes as
              | { message?: string; root?: { message?: string } }
              | undefined;
            const msg = sn?.message ?? sn?.root?.message;
            if (msg) {
              toast.error(
                <span className="text-lg md:text-sm">{msg}</span>
              );
            }
          })}
        >
        <div className="mt-4 flex flex-col gap-6">
          {/* === DocId === */}
          {docId !== null && docId != 0 && (
            <div className="flex flex-col space-y-2 md:max-w-96">
              <Label htmlFor="docId">Report No.</Label>
              <Input id="docId" type="text" value={docId.toString()} readOnly />
            </div>
          )}
          {/* === Dispatcher === */}
          <div className="flex flex-col space-y-2">
            <Label htmlFor="dispatcher">Dispatcher *</Label>
            <EmployeeSelect
              employees={adminEmployees}
              loading={loadingEmployees}
              error={employeesError}
              refetch={refetchEmployees}
              selectedEmployee={dispatcher}
              setSelectedEmployee={(emp) => {
                setDispatcher(emp);
                setValue("dispatcherId", emp?.id || null);
              }}
              placeholder="Select Dispatcher..."
            />
            <p className="text-sm text-muted-foreground mt-2">
              Select the person in charge of creating this job. If you are the dispatcher, assign yourself.
            </p>
          </div>

          {/* === Assigned Technician === */}
          <div className="flex flex-col space-y-2">
            <Label htmlFor="authorTechnician">Assigned Technician</Label>
            <EmployeeSelect
              employees={technicians}
              loading={loadingEmployees}
              error={employeesError}
              refetch={refetchEmployees}
              selectedEmployee={assignedTechnician}
              setSelectedEmployee={(emp) => {
                setAssignedTechnician(emp);
                setValue("assignedTechnicianId", emp?.id || null);
              }}
              placeholder="Select Technician..."
            />
            <p className="text-sm text-muted-foreground mt-2">
              if you are the assigned tech, assign yourself.
            </p>
          </div>

          {/* === Client Select === */}
          <div className="flex flex-col space-y-2">
            <Label htmlFor="clientSelect">Client Select *</Label>
            <ClientSelect
              selectedClient={client}
              setSelectedClient={(selected) => {
                setClient(selected || null);
                if (selected) {
                  setValue("clientId", selected.objectID);
                } else {
                  setValue("clientId", "");
                }
                // Clear any previously selected building and all its dependent fields:
                setBuilding(null);
                setValue("buildingServiceAddress1", "");
              }}
            />
          </div>

          {/* === Building Select (ShadCN) – only if client chosen === */}
          {client && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="buildingSelect">Building Select</Label>
              {client.buildings && client.buildings.length > 0 ? (
                <div className="flex flex-col gap-2 md:max-w-96">
                  <Select
                    value={building ? building.serviceAddress1 : ""}
                    onValueChange={(val) => {
                      if (val === "") {
                        setBuilding(null);
                        return;
                      }

                      const found = client.buildings.find(
                        (bld) => bld.serviceAddress1 === val
                      );

                      if (found) {
                        setBuilding(found);
                        setValue("buildingServiceAddress1", found.serviceAddress1);
                        if (!warranty) {
                          setValue("emails", [found.contactEmail]);
                        }
                        // Set as original contact
                        setOriginalContact({
                          contactName: found.contactName ?? "",
                          contactEmail: found.contactEmail ?? "",
                          contactPhone: found.contactPhone ?? "",
                        });
                      }
                    }}
                  >
                    <SelectTrigger id="buildingSelect" className="w-full">
                      <SelectValue placeholder="Select a building..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Buildings</SelectLabel>
                        {client.buildings.map(
                          (bld) =>
                            bld.serviceAddress1 !== "" && (
                              <SelectItem
                                key={
                                  bld.serviceAddress1 +
                                  (bld.contactEmail || "") +
                                  (bld.contactPhone || "")
                                }
                                value={bld.serviceAddress1}
                                className="py-2"
                              >
                                {bld.serviceAddress1}
                              </SelectItem>
                            )
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-muted-foreground text-sm">
                    No buildings found.
                  </div>
                </div>
              )}
              <Dialog open={addBuildingOpen} onOpenChange={setAddBuildingOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="secondary" className="w-fit">
                    + Add Building
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Building</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddBuilding} className="space-y-4">
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_serviceAddress1">
                        Service Address 1
                      </Label>
                      <Input
                        id="new_serviceAddress1"
                        value={newBuilding.serviceAddress1}
                        onChange={(e) =>
                          handleNewBuildingChange(
                            "serviceAddress1",
                            e.target.value
                          )
                        }
                        required
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_serviceAddress2">
                        Service Address 2
                      </Label>
                      <Input
                        id="new_serviceAddress2"
                        value={newBuilding.serviceAddress2}
                        onChange={(e) =>
                          handleNewBuildingChange(
                            "serviceAddress2",
                            e.target.value
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_cityStateZip">City, State, ZIP</Label>
                      <Input
                        id="new_cityStateZip"
                        value={newBuilding.cityStateZip}
                        onChange={(e) =>
                          handleNewBuildingChange(
                            "cityStateZip",
                            e.target.value
                          )
                        }
                        required
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_contactName">Contact Name</Label>
                      <Input
                        id="new_contactName"
                        value={newBuilding.contactName}
                        onChange={(e) =>
                          handleNewBuildingChange("contactName", e.target.value)
                        }
                        required
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_contactEmail">Contact Email</Label>
                      <Input
                        id="new_contactEmail"
                        value={newBuilding.contactEmail}
                        onChange={(e) =>
                          handleNewBuildingChange(
                            "contactEmail",
                            e.target.value
                          )
                        }
                        type="email"
                        required
                      />
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Label htmlFor="new_contactPhone">Contact Phone</Label>
                      <Input
                        id="new_contactPhone"
                        value={newBuilding.contactPhone}
                        onChange={(e) => {
                          const formatted = formatPhone(e.target.value);
                          handleNewBuildingChange("contactPhone", formatted);
                        }}
                        type="tel"
                        required
                      />
                    </div>
                    <DialogFooter>
                      <Button type="submit" variant="default">
                        Add Building
                      </Button>
                      <DialogClose asChild>
                        <Button type="button" variant="outline">
                          Cancel
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* === Contact & Address Fields (always editable, visually separated) === */}
          {building && (
            <div className="flex flex-col gap-4 p-4 mt-4 mb-2 border rounded-lg bg-muted/30">
              <Label className="font-semibold mb-2">
                Contact Information
              </Label>
              <div className="flex flex-col space-y-2">
                <Label htmlFor="contactName">Contact Name</Label>
                <Input
                  id="contactName"
                  value={building.contactName}
                  onChange={(e) =>
                    setBuilding((prev) =>
                      prev
                        ? {
                            ...prev,
                            contactName: e.target.value,
                          }
                        : null
                    )
                  }
                  placeholder="Contact Name"
                  className="text-sm"
                />
              </div>
              <div className="flex flex-col space-y-2">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input
                  id="contactEmail"
                  value={building.contactEmail}
                  onChange={(e) => {
                    setBuilding((prev) =>
                      prev
                        ? {
                            ...prev,
                            contactEmail: e.target.value,
                          }
                        : null
                    );
                    const currentEmails = getValues("emails");
                    const newEmails = [...currentEmails];
                    newEmails[0] = e.target.value; // Always update the first email
                    setValue("emails", newEmails);
                  }}
                  placeholder="Contact Email"
                  type="email"
                  className="text-sm"
                />
              </div>
              <div className="flex flex-col space-y-2">
                <Label htmlFor="contactPhone">Contact Phone</Label>
                <Input
                  id="contactPhone"
                  value={building.contactPhone}
                  onChange={(e) => {
                    const formatted = formatPhone(e.target.value);
                    setBuilding((prev) =>
                      prev ? { ...prev, contactPhone: formatted } : null
                    );
                  }}
                  type="tel"
                  placeholder="Contact Phone"
                  className="text-sm"
                />
              </div>
              {/* Save/Cancel Contact Buttons */}
              {contactChanged && (
                <div className="flex gap-2 self-end mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelContact}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleSaveContact}
                  >
                    Update Contact
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* === Warranty Checkbox === */}
          <FormField
            control={form.control}
            name="warranty"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormLabel htmlFor="warrantySwitch">Warranty Service</FormLabel>
                <FormControl>
                  <Switch
                    id="warrantySwitch"
                    checked={field.value}
                    onCheckedChange={handleWarrantyChange}
                  />
                </FormControl>
                <p className="text-sm">{field.value ? "Yes" : "No"}</p>
              </FormItem>
            )}
          />
          <p className="text-sm text-muted-foreground">
            If enabled, this will send the email to our system internally.
          </p>

          {/* === Purchase Orders Switch === */}
          <FormField
            control={form.control}
            name="linkPurchaseOrders"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2 mt-2">
                <FormLabel htmlFor="linkPurchaseOrdersSwitch">Link Purchase Orders</FormLabel>
                <FormControl>
                  <Switch
                    id="linkPurchaseOrdersSwitch"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <p className="text-sm">{field.value ? "On" : "Off"}</p>
                {loadingPOs && <Loader2 className="animate-spin h-4 w-4 ml-2 text-muted-foreground" />}
              </FormItem>
            )}
          />
          {linkPurchaseOrders && !loadingPOs && (
            <div className="mt-2 border rounded-lg p-4 bg-muted/30">
              { purchaseOrders.length === 0 ? (
                <div className="text-muted-foreground text-sm">No purchase orders found for this report.</div>
              ) : (
                <div className="space-y-4">
                  {purchaseOrders.map((po) => (
                    <div key={po.id} className="flex flex-col space-y-1">
                      <div className="sm:text-sm text-base">PO {po.docId} - {po.description}</div>
                      {/* If you want to show more PO fields, add them here as readOnly or plain text */}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === Material Notes === */}
          <FormField
            control={form.control}
            name="materialNotes"
            render={({ field }) => (
              <FormItem className="flex flex-col space-y-2">
                <FormLabel htmlFor="materialNotes">Additional Materials</FormLabel>
                <FormControl>
                  <Textarea
                    id="materialNotes"
                    {...field}
                    placeholder="Optional materials used not already in POs"
                    rows={3}
                    className="text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* === Service Notes === */}
          <FormField
            control={form.control}
            name="serviceNotes"
            render={() => (
              <FormItem className="mt-6">
                <FormLabel>Service Notes</FormLabel>
                {serviceNotes.map((note, idx) => (
                  <div key={idx} className="mt-4 border rounded-lg p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        Entry #{idx + 1}
                      </span>
                      {serviceNotes.length > 1 && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveServiceNote(idx)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name={`serviceNotes.${idx}.date`}
                      render={({ field }) => (
                        <FormItem className="md:max-w-96">
                          <FormLabel htmlFor={`noteDate_${idx}`} className="mb-2 block">
                            Date
                          </FormLabel>
                          <FormControl>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant={field.value ? "outline" : "secondary"}
                                  className={
                                    "w-full justify-start text-left font-normal flex items-center " +
                                    (!field.value ? "text-muted-foreground" : "")
                                  }
                                >
                                  <span className="flex-1 text-left">
                                    {field.value?.toDateString() || "Select date"}
                                  </span>
                                  <CalendarIcon className="ml-2 w-4 h-4 text-muted-foreground" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                />
                              </PopoverContent>
                            </Popover>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Time fields: Technician and Helper on separate rows */}
                    <div className="flex flex-col gap-2 md:gap-4">
                      {/* Technician Time */}
                      <div className="flex flex-col md:flex-row md:gap-4 space-y-4">
                        <FormField
                          control={form.control}
                          name={`serviceNotes.${idx}.technicianTime`}
                          render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel htmlFor={`technicianTime_${idx}`} className="mb-2 block">
                                Technician Time
                              </FormLabel>
                              <FormControl>
                                <TimeSelect
                                  selectedTime={field.value}
                                  setSelectedTime={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`serviceNotes.${idx}.technicianOvertime`}
                          render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel htmlFor={`technicianOvertime_${idx}`} className="mb-2 block">
                                Technician Overtime
                              </FormLabel>
                              <FormControl>
                                <TimeSelect
                                  selectedTime={field.value}
                                  setSelectedTime={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {/* Helper Time */}
                      <div className="flex flex-col md:flex-row md:gap-4 space-y-4">
                        <FormField
                          control={form.control}
                          name={`serviceNotes.${idx}.helperTime`}
                          render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel htmlFor={`helperTime_${idx}`} className="mb-2 block">
                                Helper Time
                              </FormLabel>
                              <FormControl>
                                <TimeSelect
                                  selectedTime={field.value}
                                  setSelectedTime={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`serviceNotes.${idx}.helperOvertime`}
                          render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel htmlFor={`helperOvertime_${idx}`} className="mb-2 block">
                                Helper Overtime
                              </FormLabel>
                              <FormControl>
                                <TimeSelect
                                  selectedTime={field.value}
                                  setSelectedTime={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Remote Work Switch */}
                    <FormField
                      control={form.control}
                      name={`serviceNotes.${idx}.remoteWork`}
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormLabel htmlFor={`remoteWork_${idx}`} className="mb-1">
                            Remote Work
                          </FormLabel>
                          <FormControl>
                            <Switch
                              id={`remoteWork_${idx}`}
                              className="cursor-pointer"
                              checked={field.value === "Y"}
                              onCheckedChange={(checked: boolean) =>
                                field.onChange(checked ? "Y" : "N")
                              }
                            />
                          </FormControl>
                          <span className="ml-2 text-sm">
                            {field.value === "Y" ? "Yes" : "No"}
                          </span>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`serviceNotes.${idx}.notes`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel htmlFor={`notes_${idx}`} className="mb-2 block">
                            Service Notes
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              id={`notes_${idx}`}
                              {...field}
                              rows={3}
                              placeholder="Describe work performed"
                              className="text-sm"
                            />
                          </FormControl>
                          <FormMessage />
                          <div className="flex justify-end mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const wordCount = field.value
                                  .trim()
                                  .split(/\s+/)
                                  .filter((w) => w).length;
                                if (wordCount < 6) {
                                  toast.error(
                                    <span className="text-lg md:text-sm">
                                      Please enter at least 6 words before rephrasing.
                                    </span>
                                  );
                                  return;
                                }
                                setCurrentRephraseIndex(idx);
                                setRephrase(null);
                                setRephraseDialogOpen(true);
                                handleRephrase(idx);
                              }}
                            >
                              AI Rephrase
                            </Button>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                ))}

                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4"
                  onClick={handleAddServiceNote}
                >
                  Add a Service Note
                </Button>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Add List of Contact to Send Email To */}
          {/* Create list of inputs per contact email, buttons to remove and add contact emails */}
          <div className="mt-6">
            <Label>Email Contacts</Label>
            <p className="text-sm text-muted-foreground mt-2 mb-4">
              The following emails will receive the service report:
            </p>

            {/* Display technician emails (read-only) */}
            {getTechnicianEmails().length > 0 && (
              <div className="mb-4">
                <Label className="text-sm font-medium mb-2 block">
                  Automatic (from Dispatcher, Assigned Technician, Author Technician):
                </Label>
                {getTechnicianEmails().map((email, idx) => (
                  <div key={`tech-${idx}`} className="flex items-center gap-4 mt-2 md:max-w-96">
                    <Input
                      type="email"
                      value={email}
                      readOnly
                      className="flex-1 bg-muted text-sm"
                      disabled
                    />
                    <span className="text-xs text-muted-foreground">Auto</span>
                  </div>
                ))}
              </div>
            )}

            {/* Display manual emails (editable) */}
            <FormField
              control={form.control}
              name="emails"
              render={() => (
                <FormItem>
                  <FormLabel className="text-sm font-medium mb-2 block">
                    Additional Email Contacts:
                  </FormLabel>
                  {emails.map((email, idx) => (
                    <FormField
                      key={idx}
                      control={form.control}
                      name={`emails.${idx}`}
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center gap-4 mt-2 md:max-w-96">
                            <FormControl>
                              <Input
                                type="email"
                                {...field}
                                placeholder="Contact Email"
                                className="flex-1 text-sm"
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveEmail(idx)}
                            >
                              Remove
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-4"
                    onClick={handleAddEmail}
                  >
                    Add Email Contact
                  </Button>
                </FormItem>
              )}
            />

            {/* === Preview/Save/Submit Buttons === */}
            <div className="mt-8 mb-8">
              {/* Preview button on its own line */}
              <div className="mb-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPreviewing || isSaving || isSubmitting || !client || !building}
                  onClick={handleGeneratePDF}
                >
                  {isPreviewing ? "Previewing..." : "Preview"}
                </Button>
              </div>
              {/* Save and Submit buttons on same line */}
              <div className="flex gap-4">
                <Button
                  type="button"
                  disabled={isSaving || isSubmitting || !client || !building}
                  variant="outline"
                  onClick={handleSaveDraft}
                >
                  {isSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving || isSubmitting || !client || !building}
                  variant="default"
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
      </Form>
    </>
  );
}
