"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { listReceiptFiles } from "@/lib/storage";
import {
  PurchaseOrder,
  purchaseOrderConverter,
  PurchaseOrderMessage,
} from "@/models/PurchaseOrder";
import { Input } from "@/components/ui/input";
import { Project, projectConverter, ProjectHit } from "@/models/Project";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Loader2 } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { toast } from "sonner";
import VendorSelect from "./VendorSelect";
import { Vendor, VendorHit } from "@/models/Vendor";
import { fetchVendorByName } from "@/services/orderService";
import { Employee, employeeConverter } from "@/models/Employee";
import { Switch } from "@/components/ui/switch";
import {
  buildAppliedBasAuthorizationHeader,
  getEmployeeByEmail,
} from "@/lib/services";
import { useAuth } from "@/contexts/AuthContext";
import { ServiceReport } from "@/models/ServiceReport";
import { fetchDraftServiceReports } from "@/services/reportService";
import { Textarea } from "./ui/textarea";
import ServiceReportSelect from "./ServiceReportSelect";
import { FileSelectButton } from "./FileselectButton";
import ProjectSelect from "./ProjectSelect";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

interface PurchaseOrderFormProps {
  purchaseOrder: PurchaseOrder;
}

// Zod schema for purchase order form validation
const purchaseOrderFormSchema = z
  .object({
    vendor: z.string().min(1, "Vendor is required"),
    categoryType: z.enum(["other", "project", "service"]).nullable(),
    otherCategory: z.string().optional(),
    projectDocId: z.number().optional().nullable(),
    serviceReportDocId: z.number().optional().nullable(),
    amount: z.string().refine(
      (val) => {
        const parsed = parseFloat(val);
        return !isNaN(parsed) && parsed > 0;
      },
      { message: "Amount must be greater than 0" }
    ),
    description: z.string().min(1, "Description is required"),
  })
  .refine(
    (data) => {
      if (data.categoryType === "other") {
        return !!data.otherCategory && data.otherCategory.trim().length > 0;
      }
      return true;
    },
    {
      message: "Other category is required",
      path: ["otherCategory"],
    }
  )
  .refine(
    (data) => {
      if (data.categoryType === "project") {
        return !!data.projectDocId;
      }
      return true;
    },
    {
      message: "Project is required",
      path: ["projectDocId"],
    }
  )
  .refine(
    (data) => {
      if (data.categoryType === "service") {
        return !!data.serviceReportDocId;
      }
      return true;
    },
    {
      message: "Service report is required",
      path: ["serviceReportDocId"],
    }
  )
  .refine(
    (data) => {
      return !!data.categoryType;
    },
    {
      message: "Please select a category type",
      path: ["categoryType"],
    }
  );

type PurchaseOrderFormValues = z.infer<typeof purchaseOrderFormSchema>;

type ReceiptItem = {
  id: string;
  /** Local file being uploaded; null when row is loaded from storage only */
  file: File | null;
  displayName: string;
  contentType: string;
  storagePath: string | null;
  uploading: boolean;
  error: string | null;
  /** Blob URL for local preview and/or Firebase download URL after upload / from bucket */
  viewUrl: string | null;
};

function receiptExtension(file: File): string {
  if (file.type && file.type.includes("/")) {
    return file.type.split("/")[1];
  }
  if (file.name.includes(".")) {
    return file.name.split(".").pop() || "file";
  }
  return "file";
}

function revokeReceiptViewUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function guessMimeFromFileName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jpe: "image/jpeg",
    png: "image/png",
    pdf: "application/pdf",
    heic: "image/heic",
    heif: "image/heif",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
    gif: "image/gif",
  };
  return ext && map[ext] ? map[ext] : "application/octet-stream";
}

export default function PurchaseOrderForm({
  purchaseOrder,
}: PurchaseOrderFormProps) {
  const { user } = useAuth();
  
  // Form state
  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderFormSchema),
    defaultValues: {
      vendor: purchaseOrder.vendor || "",
      categoryType: null,
      otherCategory: purchaseOrder.otherCategory || "",
      projectDocId: purchaseOrder.projectDocId || null,
      serviceReportDocId: purchaseOrder.serviceReportDocId || null,
      amount: purchaseOrder.amount?.toString() || "",
      description: purchaseOrder.description || "",
    },
  });

  const { watch, setValue, getValues, formState } = form;
  const categoryType = watch("categoryType");
  const amount = watch("amount");

  // UI state (not form data)
  const [technician, setTechnician] = useState<Employee | null>(null);
  const [vendor, setVendor] = useState<VendorHit | null>(null);
  const [serviceReports, setServiceReports] = useState<ServiceReport[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectHit | null>(
    null
  );
  const [selectedServiceReport, setSelectedServiceReport] =
    useState<ServiceReport | null>(null);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [removingReceiptId, setRemovingReceiptId] = useState<string | null>(
    null
  );
  /** Prevents duplicate uploads when Strict Mode re-runs effects or state updaters. */
  const uploadInitiatedRef = useRef<Set<string>>(new Set());

  const receiptUploading = receiptItems.some((i) => i.uploading);

  const getAmountAsNumber = (): number => {
    const parsed = parseFloat(amount || "0");
    return isNaN(parsed) ? 0 : parsed;
  };

  const canSubmit: boolean =
    formState.isValid &&
    !!vendor &&
    receiptItems.length > 0 &&
    receiptItems.every(
      (i) => !!i.storagePath && !i.uploading && !i.error
    );

  const uploadReceiptForItem = useCallback(
    async (itemId: string, file: File | null) => {
      if (!file) return;
      const storage = getStorage();
      const folder = `po-${purchaseOrder.docId!}`;
      const ext = receiptExtension(file);
      const fileName = `attachment_${itemId}.${ext}`;
      const storagePath = `receipts/${folder}/${fileName}`;
      const storageRef = ref(storage, storagePath);
      try {
        const contentType =
          file.type && file.type.length > 0
            ? file.type
            : guessMimeFromFileName(file.name);
        await uploadBytes(storageRef, file, { contentType });
        const downloadUrl = await getDownloadURL(storageRef);
        setReceiptItems((prev) => {
          if (!prev.some((i) => i.id === itemId)) return prev;
          return prev.map((i) => {
            if (i.id !== itemId) return i;
            revokeReceiptViewUrl(i.viewUrl);
            return {
              ...i,
              storagePath,
              uploading: false,
              error: null,
              viewUrl: downloadUrl,
            };
          });
        });
      } catch (reason) {
        console.error(`Failed to upload file ${file.name}:`, reason);
        setReceiptItems((prev) => {
          if (!prev.some((i) => i.id === itemId)) return prev;
          return prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  uploading: false,
                  error: `Failed to upload ${file.name}`,
                }
              : i
          );
        });
        toast.error(
          `Failed to upload attachment: ${file.name}. Please try again or remove it.`
        );
      }
    },
    [purchaseOrder.docId]
  );

  useEffect(() => {
    for (const item of receiptItems) {
      if (!item.file || !item.uploading || item.storagePath || item.error)
        continue;
      if (uploadInitiatedRef.current.has(item.id)) continue;
      uploadInitiatedRef.current.add(item.id);
      void uploadReceiptForItem(item.id, item.file);
    }
  }, [receiptItems, uploadReceiptForItem]);

  useEffect(() => {
    let cancelled = false;
    const docId = purchaseOrder.docId;
    if (docId == null) return;

    (async () => {
      try {
        const files = await listReceiptFiles(`po-${docId}`);
        if (cancelled) return;
        setReceiptItems((prev) => {
          const bucketPaths = new Set(files.map((f) => f.storagePath));
          const bucketItems: ReceiptItem[] = files.map((f) => ({
            id: `bucket:${f.storagePath}`,
            file: null,
            displayName: f.name,
            contentType: guessMimeFromFileName(f.name),
            storagePath: f.storagePath,
            uploading: false,
            error: null,
            viewUrl: f.url,
          }));
          const locals = prev.filter((i) => {
            if (i.file === null) return false;
            if (i.storagePath && bucketPaths.has(i.storagePath)) return false;
            return true;
          });
          return [...bucketItems, ...locals];
        });
      } catch (reason) {
        if (!cancelled) {
          console.error("Failed to list receipts from storage:", reason);
          toast.error("Could not load existing receipts from storage.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [purchaseOrder.docId]);

  const openReceiptView = (item: ReceiptItem) => {
    if (!item.viewUrl) return;
    window.open(item.viewUrl, "_blank", "noopener,noreferrer");
  };

  const removeReceiptItem = async (item: ReceiptItem) => {
    if (item.uploading || removingReceiptId === item.id) return;
    if (item.storagePath) {
      setRemovingReceiptId(item.id);
      try {
        const storage = getStorage();
        await deleteObject(ref(storage, item.storagePath));
      } catch (reason) {
        const code =
          reason instanceof FirebaseError ? reason.code : undefined;
        if (code !== "storage/object-not-found") {
          console.error("Failed to delete receipt from storage:", reason);
          toast.error(
            "Could not remove the file from storage. Please try again."
          );
          setRemovingReceiptId(null);
          return;
        }
      }
      setRemovingReceiptId(null);
    }
    revokeReceiptViewUrl(item.viewUrl);
    uploadInitiatedRef.current.delete(item.id);
    setReceiptItems((prev) => prev.filter((p) => p.id !== item.id));
  };

  useEffect(() => {
    async function initForm() {
      if (!purchaseOrder) return;

      if (purchaseOrder.vendor) {
        const vendorData: Vendor | null = await fetchVendorByName(
          purchaseOrder.vendor
        );

        if (vendorData) {
          setVendor({
            objectID: vendorData.id,
            name: vendorData.name,
            active: vendorData.active,
            id: vendorData.id,
          });
          setValue("vendor", vendorData.name);
        }
      }

      if (purchaseOrder.technicianRef) {
        const empSnap = await getDoc(
          purchaseOrder.technicianRef.withConverter(employeeConverter)
        );
        if (empSnap.exists()) {
          const emp = empSnap.data() as Employee;
          setTechnician(emp);
        }
      }

      const draftSR = await fetchDraftServiceReports();

      if (purchaseOrder.projectDocId) {
        // Fetch the project by docId
        const q = query(
          collection(firestore, "projects").withConverter(projectConverter),
          where("doc-id", "==", purchaseOrder.projectDocId)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const proj = snap.docs[0].data() as Project;
          setSelectedProject({
            objectID: snap.docs[0].id,
            docId: proj.docId,
            client: proj.client,
            description: proj.description,
            location: proj.location,
            active: proj.active,
            balance: proj.balance ?? 0,
            createdAt: proj.createdAt ? proj.createdAt.toDate().toISOString() : "",
          });
          setValue("projectDocId", proj.docId);
        }
        setValue("categoryType", "project");
      } else if (purchaseOrder.serviceReportDocId) {
        const serviceReport = draftSR.find(
          (r) => r.docId === purchaseOrder.serviceReportDocId
        );
        setSelectedServiceReport(serviceReport || null);
        if (serviceReport) {
          setValue("serviceReportDocId", Number(serviceReport.docId));
        }
        setValue("categoryType", "service");
      } else if (purchaseOrder.otherCategory) {
        setValue("otherCategory", purchaseOrder.otherCategory);
        setValue("categoryType", "other");
      } else {
        setValue("categoryType", "other");
      }
      setServiceReports(draftSR);
    }
    initForm();
  }, [purchaseOrder, setValue]);

  // Sync project selection with form state
  useEffect(() => {
    if (selectedProject) {
      setValue("projectDocId", selectedProject.docId, { shouldValidate: true });
    } else if (categoryType !== "project") {
      setValue("projectDocId", null);
    }
  }, [selectedProject, categoryType, setValue]);

  // Sync service report selection with form state
  useEffect(() => {
    if (selectedServiceReport) {
      setValue("serviceReportDocId", Number(selectedServiceReport.docId), { shouldValidate: true });
    } else if (categoryType !== "service") {
      setValue("serviceReportDocId", null);
    }
  }, [selectedServiceReport, categoryType, setValue]);

  // Sync vendor selection with form state
  useEffect(() => {
    if (vendor) {
      setValue("vendor", vendor.name, { shouldValidate: true });
    }
  }, [vendor, setValue]);

  // Only show the input for the selected category, set others to null
  useEffect(() => {
    if (categoryType === "other") {
      setSelectedProject(null);
      setSelectedServiceReport(null);
      setValue("projectDocId", null);
      setValue("serviceReportDocId", null);
    } else if (categoryType === "project") {
      setValue("otherCategory", "");
      setSelectedServiceReport(null);
      setValue("serviceReportDocId", null);
    } else if (categoryType === "service") {
      setValue("otherCategory", "");
      setSelectedProject(null);
      setValue("projectDocId", null);
    }
  }, [categoryType, setValue]);

  // Warn user if they try to navigate away during upload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (receiptUploading) {
        e.preventDefault();
        e.returnValue = "Receipts are still uploading. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [receiptUploading]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "image/heic",
      "image/heif",
      "image/tiff",
      "image/bmp",
      "image/gif",
    ];
    const newFilesArr = Array.from(files);
    const filteredFiles = newFilesArr.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`File type not allowed: ${file.name}`);
        return false;
      }
      return true;
    });
    setReceiptItems((prev) => {
      const uniqueNew = filteredFiles.filter(
        (file) =>
          !prev.some(
            (p) =>
              p.file &&
              p.file.name === file.name &&
              p.file.size === file.size
          )
      );
      const toAdd: ReceiptItem[] = uniqueNew.map((file) => ({
        id: crypto.randomUUID(),
        file,
        displayName: file.name,
        contentType:
          file.type && file.type.length > 0
            ? file.type
            : guessMimeFromFileName(file.name),
        storagePath: null,
        uploading: true,
        error: null,
        viewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...toAdd];
    });
  };

  // Save as draft
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const formData = getValues();
      const orderRef = doc(firestore, "orders", purchaseOrder.id).withConverter(
        purchaseOrderConverter
      );
      const data: PurchaseOrder = {
        amount: getAmountAsNumber(),
        createdAt: purchaseOrder.createdAt,
        description: formData.description,
        docId: purchaseOrder.docId,
        id: purchaseOrder.id,
        otherCategory: formData.otherCategory || null,
        projectDocId: formData.projectDocId || null,
        serviceReportDocId: formData.serviceReportDocId || null,
        status: "OPEN",
        technicianRef: purchaseOrder.technicianRef,
        vendor: formData.vendor,
      };
      await setDoc(orderRef, data, { merge: true });

      toast.success("Draft saved successfully!");
    } catch (error) {
      toast.error("Failed to save draft. Try again later.");
      console.error("Error saving draft:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Submit (finalize)
  const handleSubmit = async (data: PurchaseOrderFormValues) => {
    // Prevent submission if any operation is already in progress
    if (isSaving || isSubmitting || receiptUploading) {
      return;
    }
    
    if (!user) {
      toast.error("You must be logged in to submit a purchase order.");
      return;
    }

    if (receiptItems.length === 0) {
      toast.error("Please attach at least one receipt.");
      return;
    }

    const paths = receiptItems
      .map((i) => i.storagePath)
      .filter((p): p is string => p != null);
    if (paths.length !== receiptItems.length) {
      toast.error("Please wait for all receipts to finish uploading.");
      return;
    }

    setIsSubmitting(true);

    try {
      const currentEmployee = await getEmployeeByEmail(user.email!);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);

      const message: PurchaseOrderMessage = {
        amount: getAmountAsNumber(),
        materials: data.description,
        purchase_order_num: purchaseOrder.docId,
        project_info: selectedProject
          ? `${selectedProject.docId} - ${selectedProject.client} - ${selectedProject.location}`
          : null,
        service_report_info: selectedServiceReport
          ? `${selectedServiceReport.docId}`
          : null,
        other: data.otherCategory || null,
        vendor: data.vendor,
        technician_name: technician ? technician.name : "",
        technician_phone: technician ? technician.phone : "",
        technician_email: technician ? technician.email : "",
        attachment_storage_paths: paths,
        attachment_types: receiptItems.map((i) => i.contentType),
      };

      const res = await fetch("/api/mail/po", {
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
        throw new Error(
          `Mail API returned status ${res.status} instead of expected 2xx range. ${
            result.message ? `Response: ${result.message}` : ""
          }`
        );
      }

      const orderRef = doc(firestore, "orders", purchaseOrder.id).withConverter(
        purchaseOrderConverter
      );
      const orderData: PurchaseOrder = {
        amount: getAmountAsNumber(),
        createdAt: purchaseOrder.createdAt,
        description: data.description,
        docId: purchaseOrder.docId,
        id: purchaseOrder.id,
        otherCategory: data.otherCategory || null,
        projectDocId: data.projectDocId || null,
        serviceReportDocId: data.serviceReportDocId || null,
        status: "CLOSED",
        technicianRef: purchaseOrder.technicianRef,
        vendor: data.vendor,
      };

      await setDoc(orderRef, orderData, { merge: true });

      setSubmittedOrderId(purchaseOrder.id);
      setSubmitDialogOpen(true);

      toast.success("Purchase order submitted successfully!");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to submit purchase order.";
      toast.error(errorMessage);
      console.error("Error submitting purchase order:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseDialog = () => {
    try {
      window.location.href = `/dashboard/purchase-orders/${submittedOrderId!}`;
    } catch (error) {
      toast.error("Failed to redirect. Please try again.");
      console.error("Error redirecting:", error);
    }
  };

  // Form is always ready - page handles loading state and ensures all data is available

  return (
    <>
      {/* Fixed Loading Indicator */}
      {(isSubmitting || isSaving || receiptUploading) && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-background border rounded-lg shadow-lg px-4 py-3">
          <Loader2 className="animate-spin h-5 w-5 text-primary" />
          <span className="text-sm font-medium">
            {receiptUploading ? "Uploading receipts..." : isSubmitting ? "Submitting..." : "Saving..."}
          </span>
        </div>
      )}
      {/* Submit Success Dialog */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Order Submitted</DialogTitle>
          </DialogHeader>
          <div className="py-4">Your purchase order was sent successfully.</div>
          <DialogFooter>
            <Button onClick={handleCloseDialog}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="docId">PO Number</Label>
            <Input
              id="docId"
              value={purchaseOrder.docId}
              readOnly
              className="w-full md:max-w-96"
            />
          </div>
          <FormField
            control={form.control}
            name="vendor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor *</FormLabel>
                <FormControl>
                  <VendorSelect
                    selectedVendor={vendor}
                    setSelectedVendor={(v) => {
                      setVendor(v);
                      field.onChange(v ? v.name : "");
                    }}
                    placeholder="Select a vendor"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="categoryType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Attach To *</FormLabel>
                <FormControl>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.value === "service"}
                        onCheckedChange={(checked) =>
                          field.onChange(checked ? "service" : null)
                        }
                        id="switch-service"
                      />
                      <Label htmlFor="switch-service">Service Report</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.value === "project"}
                        onCheckedChange={(checked) =>
                          field.onChange(checked ? "project" : null)
                        }
                        id="switch-project"
                      />
                      <Label htmlFor="switch-project">Project</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.value === "other"}
                        onCheckedChange={(checked) =>
                          field.onChange(checked ? "other" : null)
                        }
                        id="switch-other"
                      />
                      <Label htmlFor="switch-other">Other</Label>
                    </div>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {categoryType === "other" && (
            <FormField
              control={form.control}
              name="otherCategory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Other Category *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full md:max-w-96"
                      placeholder="e.g. Truck Stock, Software License"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {categoryType === "project" && (
            <FormField
              control={form.control}
              name="projectDocId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project *</FormLabel>
                  <FormControl>
                    <ProjectSelect
                      selectedProject={selectedProject}
                      setSelectedProject={(project) => {
                        setSelectedProject(project);
                        field.onChange(project ? project.docId : null);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {categoryType === "service" && (
            <FormField
              control={form.control}
              name="serviceReportDocId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Report *</FormLabel>
                  <FormControl>
                    <ServiceReportSelect
                      selectedReport={selectedServiceReport}
                      setSelectedReport={(report) => {
                        setSelectedServiceReport(report);
                        field.onChange(report ? Number(report.docId) : null);
                      }}
                      reports={serviceReports}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount *</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow empty string, or valid number format (with optional negative, digits, and single decimal point)
                      if (
                        value === "" ||
                        value === "-" ||
                        value === "." ||
                        /^-?\d*\.?\d*$/.test(value)
                      ) {
                        field.onChange(value);
                      }
                    }}
                    onBlur={() => {
                      field.onBlur();
                      // Validate and clean up on blur
                      const parsed = parseFloat(field.value || "0");
                      if (!isNaN(parsed) && parsed > 0) {
                        // Format to remove leading zeros and unnecessary decimals
                        field.onChange(parsed.toString());
                      }
                    }}
                    className="w-full md:max-w-96"
                    placeholder="0.00"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description *</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="w-full min-h-[80px]"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        <div className="flex flex-col gap-2">
          <Label htmlFor="receipts">Receipts *</Label>
          <FileSelectButton
            onFilesSelected={handleFiles}
            multiple
            accept=".jpg,.jpeg,.png,.pdf,.heic,.heif,.tiff,.bmp,.gif"
            label="Upload Files"
          />
          {receiptItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {receiptItems.map((item) => {
                const canOpenView = !!item.viewUrl;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-1 bg-muted text-foreground rounded-full text-sm shadow border border-border max-w-xs"
                  >
                    <button
                      type="button"
                      className={`flex min-w-0 flex-1 items-center gap-1 truncate rounded-l-full py-1 pl-3 pr-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        canOpenView
                          ? "cursor-pointer hover:bg-muted-foreground/10"
                          : "cursor-default opacity-80"
                      }`}
                      title={
                        canOpenView
                          ? `View ${item.displayName}`
                          : item.displayName
                      }
                      disabled={!canOpenView}
                      onClick={() => openReceiptView(item)}
                    >
                      {item.uploading && (
                        <Loader2
                          className="h-3 w-3 shrink-0 animate-spin text-primary"
                          aria-hidden
                        />
                      )}
                      <span className="truncate max-w-[120px]">
                        {item.displayName}
                      </span>
                      {item.error && (
                        <span className="text-xs text-destructive shrink-0">
                          Failed
                        </span>
                      )}
                      {!item.uploading && item.storagePath && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          Ready
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="mr-2 shrink-0 text-muted-foreground hover:text-destructive focus:outline-none disabled:opacity-50"
                      aria-label={`Remove ${item.displayName}`}
                      disabled={
                        item.uploading || removingReceiptId === item.id
                      }
                      onClick={() => void removeReceiptItem(item)}
                    >
                      {removingReceiptId === item.id ? (
                        <Loader2
                          className="h-3 w-3 shrink-0 animate-spin text-primary"
                          aria-hidden
                        />
                      ) : (
                        "\u00d7"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {receiptItems.some((i) => i.error) && (
            <div className="mt-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm font-medium text-destructive mb-1">
                Some uploads failed
              </p>
              <ul className="text-sm text-destructive/80 list-disc list-inside space-y-1">
                {receiptItems
                  .filter((i) => i.error)
                  .map((item) => (
                    <li key={item.id}>{item.error}</li>
                  ))}
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                Remove failed attachments or try again.
              </p>
            </div>
          )}
        </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSave}
              disabled={isSaving || isSubmitting || receiptUploading}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || isSubmitting || receiptUploading || !canSubmit}
            >
              {receiptUploading ? "Uploading..." : isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
