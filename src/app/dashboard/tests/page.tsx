"use client";

import React, { useState } from "react";
import { ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { PurchaseOrderMessage } from "@/models/PurchaseOrder";
import type {
  ServiceReportMessage,
  ServiceReportPDFMessage,
} from "@/models/ServiceReport";
import type {
  ProjectReportMessage,
  ProjectReportPDFMessage,
} from "@/models/ProjectReport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildAppliedBasAuthorizationHeader,
  getEmployeeByEmail,
} from "@/lib/services";
import { FileSelectButton } from "@/components/FileselectButton";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type ReceiptItem = {
  id: string;
  file: File;
  storagePath: string | null;
  uploading: boolean;
  error: string | null;
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

function buildSrSelfTestMessage(employee: {
  name: string;
  phone: string;
  email: string;
}): ServiceReportMessage {
  const d = new Date().toLocaleDateString("en-US");
  return {
    report_no: 999999,
    date: d,
    client_name: "Mail API self-test (not a real client)",
    service_address: "100 Self-Test St",
    city_state_zip: "Denver, CO 80014",
    contact_name: "Self-test contact",
    contact_phone: "303-555-0199",
    contact_email: "selftest@example.com",
    signature: null,
    t_time: 0.5,
    t_ot: 0,
    h_time: 0,
    h_ot: 0,
    materials: "Mail API self-test (safe to ignore)",
    notes: [
      {
        date: d,
        t_time: 0.5,
        t_ot: 0,
        h_time: 0,
        h_ot: 0,
        remote: "N",
        note: "Self-test service report note",
      },
    ],
    technician_name: employee.name,
    technician_phone: employee.phone,
    technician_email: employee.email,
    print_name: null,
    sign_date: null,
    to_emails: ["placeholder@example.com"],
    start_date: d,
    end_date: d,
  };
}

function buildPrSelfTestMessage(employee: {
  name: string;
  phone: string;
  email: string;
}): ProjectReportMessage {
  const d = new Date().toLocaleDateString("en-US");
  return {
    technician_name: employee.name,
    technician_phone: employee.phone,
    technician_email: employee.email,
    location: "Self-test site (not real)",
    description: "Mail API self-test (safe to ignore)",
    project_id: 999999,
    doc_id: 1,
    project_subtitle: "PR self-test 999999-1",
    date: d,
    client_name: "Mail API self-test client",
    materials: "None",
    notes: "Self-test project report notes",
  };
}

/** Payload for `POST /api/pdf/sr` (same shape as production preview). */
function buildSrPdfPayload(employee: {
  name: string;
  phone: string;
}): ServiceReportPDFMessage {
  const d = new Date().toLocaleDateString("en-US");
  return {
    report_no: 999999,
    date: d,
    client_name: "PDF self-test (not a real client)",
    service_address: "100 Self-Test St",
    city_state_zip: "Denver, CO 80014",
    contact_name: "Self-test contact",
    contact_phone: "303-555-0199",
    contact_email: "selftest@example.com",
    signature: null,
    t_time: 0.5,
    t_ot: 0,
    h_time: 0,
    h_ot: 0,
    materials: "PDF API self-test (safe to ignore)",
    notes: [
      {
        date: d,
        t_time: 0.5,
        t_ot: 0,
        h_time: 0,
        h_ot: 0,
        remote: "N",
        note: "Self-test PDF generation note",
      },
    ],
    technician_name: employee.name,
    technician_phone: employee.phone,
    print_name: null,
    sign_date: null,
  };
}

/** Payload for `POST /api/pdf/pr`. */
function buildPrPdfPayload(employee: {
  name: string;
  phone: string;
}): ProjectReportPDFMessage {
  const d = new Date().toLocaleDateString("en-US");
  return {
    project_no: 999999,
    doc_id: 1,
    project_subtitle: "PR PDF self-test 999999-1",
    date: d,
    client_name: "PDF self-test client",
    location: "Self-test site (not real)",
    materials: "None",
    notes: "Self-test project report PDF notes",
    technician_name: employee.name,
    technician_phone: employee.phone,
  };
}

function PdfApiResponseBlock({ raw }: { raw: string }) {
  let url: string | undefined;
  try {
    const parsed = JSON.parse(raw) as { url?: string };
    url = typeof parsed.url === "string" ? parsed.url : undefined;
  } catch {
    /* not JSON */
  }
  return (
    <div className="space-y-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline break-all block"
        >
          Open generated PDF
        </a>
      ) : null}
      <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
        {raw}
      </pre>
    </div>
  );
}

export default function DashboardTestsPage() {
  const { user } = useAuth();
  const [poNum, setPoNum] = useState<string>("");
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [sendingPo, setSendingPo] = useState(false);
  const [sendingSr, setSendingSr] = useState(false);
  const [sendingPr, setSendingPr] = useState(false);
  const [generatingSrPdf, setGeneratingSrPdf] = useState(false);
  const [generatingPrPdf, setGeneratingPrPdf] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [lastSrPdfResponse, setLastSrPdfResponse] = useState<string | null>(
    null
  );
  const [lastPrPdfResponse, setLastPrPdfResponse] = useState<string | null>(
    null
  );

  const receiptUploading = receiptItems.some((i) => i.uploading);

  const uploadReceiptForItem = async (
    itemId: string,
    file: File,
    docId: number
  ) => {
    const folder = `po-${docId}`;
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
      setReceiptItems((prev) => {
        if (!prev.some((i) => i.id === itemId)) return prev;
        return prev.map((i) =>
          i.id === itemId
            ? { ...i, storagePath, uploading: false, error: null }
            : i
        );
      });
    } catch (reason) {
      console.error(reason);
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
      toast.error(`Upload failed: ${file.name}`);
    }
  };

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
    const docId = parseInt(poNum, 10);
    if (Number.isNaN(docId) || docId <= 0) {
      toast.error(
        "Enter a valid PO number first (matches receipts/po-{number}/ in Storage)."
      );
      return;
    }
    const filtered = Array.from(files).filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        toast.error(
          `Not allowed: ${file.name} (${file.type || "unknown type"})`
        );
        return false;
      }
      return true;
    });
    setReceiptItems((prev) => {
      const uniqueNew = filtered.filter(
        (file) =>
          !prev.some(
            (p) => p.file.name === file.name && p.file.size === file.size
          )
      );
      const toAdd: ReceiptItem[] = uniqueNew.map((file) => ({
        id: crypto.randomUUID(),
        file,
        storagePath: null,
        uploading: true,
        error: null,
      }));
      if (toAdd.length) {
        queueMicrotask(() => {
          toAdd.forEach((item) =>
            void uploadReceiptForItem(item.id, item.file, docId)
          );
        });
      }
      return [...prev, ...toAdd];
    });
  };

  const sendPoTest = async () => {
    setLastResponse(null);
    if (!user?.email) {
      toast.error("You must be signed in.");
      return;
    }
    const docId = parseInt(poNum, 10);
    if (Number.isNaN(docId) || docId <= 0) {
      toast.error("Enter a valid PO number.");
      return;
    }
    const paths = receiptItems
      .map((i) => i.storagePath)
      .filter((p): p is string => p != null);
    if (
      paths.length === 0 ||
      receiptUploading ||
      receiptItems.some((i) => i.error)
    ) {
      toast.error("Add files and wait until all uploads finish.");
      return;
    }

    setSendingPo(true);
    try {
      const currentEmployee = await getEmployeeByEmail(user.email);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);
      const message: PurchaseOrderMessage = {
        amount: 0.01,
        materials: "Mail API self-test (safe to ignore)",
        purchase_order_num: docId,
        project_info: null,
        service_report_info: null,
        other: "Mail API self-test",
        vendor: "Self-test vendor (not a real PO)",
        technician_name: currentEmployee.name,
        technician_phone: currentEmployee.phone,
        technician_email: currentEmployee.email,
        attachment_storage_paths: paths,
        attachment_types: receiptItems.map((i) => i.file.type),
      };

      const res = await fetch("/api/mail/po/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });

      const raw = await res.text();
      setLastResponse(raw);
      let parsed: {
        message?: string;
        sent_to?: string;
        attachment_count?: number;
      } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* plain text error */
      }

      if (!res.ok) {
        toast.error(parsed.message || `HTTP ${res.status}`);
        return;
      }
      toast.success(
        parsed.message ||
          `Sent to ${parsed.sent_to ?? "you"} (${parsed.attachment_count ?? paths.length} attachment(s))`
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Request failed.";
      toast.error(msg);
    } finally {
      setSendingPo(false);
    }
  };

  const generateSrPdf = async () => {
    setLastSrPdfResponse(null);
    if (!user?.email) {
      toast.error("You must be signed in.");
      return;
    }
    setGeneratingSrPdf(true);
    try {
      const currentEmployee = await getEmployeeByEmail(user.email);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);
      const payload = buildSrPdfPayload(currentEmployee);

      const res = await fetch("/api/pdf/sr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      setLastSrPdfResponse(raw);
      let parsed: { message?: string; url?: string } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        toast.error(parsed.message || `HTTP ${res.status}`);
        return;
      }
      toast.success(parsed.message || "Service report PDF generated.");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Request failed.";
      toast.error(msg);
    } finally {
      setGeneratingSrPdf(false);
    }
  };

  const generatePrPdf = async () => {
    setLastPrPdfResponse(null);
    if (!user?.email) {
      toast.error("You must be signed in.");
      return;
    }
    setGeneratingPrPdf(true);
    try {
      const currentEmployee = await getEmployeeByEmail(user.email);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);
      const payload = buildPrPdfPayload(currentEmployee);

      const res = await fetch("/api/pdf/pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      setLastPrPdfResponse(raw);
      let parsed: { message?: string; url?: string } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        toast.error(parsed.message || `HTTP ${res.status}`);
        return;
      }
      toast.success(parsed.message || "Project report PDF generated.");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Request failed.";
      toast.error(msg);
    } finally {
      setGeneratingPrPdf(false);
    }
  };

  const sendSrTest = async () => {
    setLastResponse(null);
    if (!user?.email) {
      toast.error("You must be signed in.");
      return;
    }
    setSendingSr(true);
    try {
      const currentEmployee = await getEmployeeByEmail(user.email);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);
      const message = buildSrSelfTestMessage(currentEmployee);

      const res = await fetch("/api/mail/sr/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });

      const raw = await res.text();
      setLastResponse(raw);
      let parsed: { message?: string; sent_to?: string } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        toast.error(parsed.message || `HTTP ${res.status}`);
        return;
      }
      toast.success(
        parsed.message ||
          `SR self-test sent to ${parsed.sent_to ?? "your email"}`
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Request failed.";
      toast.error(msg);
    } finally {
      setSendingSr(false);
    }
  };

  const sendPrTest = async () => {
    setLastResponse(null);
    if (!user?.email) {
      toast.error("You must be signed in.");
      return;
    }
    setSendingPr(true);
    try {
      const currentEmployee = await getEmployeeByEmail(user.email);
      const authorizationHeader =
        buildAppliedBasAuthorizationHeader(currentEmployee);
      const message = buildPrSelfTestMessage(currentEmployee);

      const res = await fetch("/api/mail/pr/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorizationHeader,
        },
        body: JSON.stringify(message),
      });

      const raw = await res.text();
      setLastResponse(raw);
      let parsed: { message?: string; sent_to?: string } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        toast.error(parsed.message || `HTTP ${res.status}`);
        return;
      }
      toast.success(
        parsed.message ||
          `PR self-test sent to ${parsed.sent_to ?? "your email"}`
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Request failed.";
      toast.error(msg);
    } finally {
      setSendingPr(false);
    }
  };

  const readyToSendPo =
    receiptItems.length > 0 &&
    receiptItems.every((i) => i.storagePath && !i.uploading && !i.error) &&
    !Number.isNaN(parseInt(poNum, 10)) &&
    parseInt(poNum, 10) > 0;

  const anySending = sendingPo || sendingSr || sendingPr;
  const anyPdfBusy = generatingSrPdf || generatingPrPdf;
  const anyBusy = anySending || anyPdfBusy;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tests</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Mail API self-tests: send a <strong>test</strong> email{" "}
          <strong>only to your</strong> employee email. Production To/Bcc routing
          is not used. PO tests require receipt files under{" "}
          <code className="text-xs">receipts/po-&#123;number&#125;/…</code> in
          Firebase Storage. SR/PR can also call{" "}
          <code className="text-xs">/api/pdf/sr</code> and{" "}
          <code className="text-xs">/api/pdf/pr</code> to generate a PDF only.
        </p>
      </div>

      <Tabs defaultValue="po" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="po">Purchase order</TabsTrigger>
          <TabsTrigger value="sr">Service report</TabsTrigger>
          <TabsTrigger value="pr">Project report</TabsTrigger>
        </TabsList>

        <TabsContent value="po" className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="poNum">PO number (doc-id)</Label>
            <Input
              id="poNum"
              type="number"
              min={1}
              placeholder="e.g. 12345"
              value={poNum}
              onChange={(e) => setPoNum(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Receipt files</Label>
            <FileSelectButton
              onFilesSelected={handleFiles}
              multiple
              accept=".jpg,.jpeg,.png,.pdf,.heic,.heif,.tiff,.bmp,.gif"
              label="Choose files"
            />
            {receiptItems.length > 0 && (
              <ul className="text-sm space-y-1 border rounded-md p-3 bg-muted/30">
                {receiptItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    {item.uploading && (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    )}
                    <span className="truncate">{item.file.name}</span>
                    {item.storagePath && (
                      <span className="text-xs text-muted-foreground">
                        ready
                      </span>
                    )}
                    {item.error && (
                      <span className="text-xs text-destructive">
                        {item.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            onClick={sendPoTest}
            disabled={
              !readyToSendPo || sendingPo || !user?.email || anyBusy
            }
          >
            {sendingPo ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send PO test to my email"
            )}
          </Button>
        </TabsContent>

        <TabsContent value="sr" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Uses a fixed dummy service report payload (report #999999). Mail
            self-test: <code className="text-xs">/api/mail/sr/test</code>{" "}
            (generates PDF, uploads, emails only you). PDF only:{" "}
            <code className="text-xs">/api/pdf/sr</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void generateSrPdf()}
              disabled={!user?.email || anyBusy}
            >
              {generatingSrPdf ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating PDF…
                </>
              ) : (
                "Generate PDF only"
              )}
            </Button>
            <Button
              onClick={sendSrTest}
              disabled={!user?.email || anyBusy}
            >
              {sendingSr ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send SR test to my email"
              )}
            </Button>
          </div>
          {lastSrPdfResponse && (
            <div className="space-y-1">
              <Label>Last PDF response</Label>
              <PdfApiResponseBlock raw={lastSrPdfResponse} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="pr" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Uses a fixed dummy project report payload (project #999999). Mail
            self-test: <code className="text-xs">/api/mail/pr/test</code>. PDF
            only: <code className="text-xs">/api/pdf/pr</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void generatePrPdf()}
              disabled={!user?.email || anyBusy}
            >
              {generatingPrPdf ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating PDF…
                </>
              ) : (
                "Generate PDF only"
              )}
            </Button>
            <Button
              onClick={sendPrTest}
              disabled={!user?.email || anyBusy}
            >
              {sendingPr ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send PR test to my email"
              )}
            </Button>
          </div>
          {lastPrPdfResponse && (
            <div className="space-y-1">
              <Label>Last PDF response</Label>
              <PdfApiResponseBlock raw={lastPrPdfResponse} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {lastResponse && (
        <div className="space-y-1">
          <Label>Last response</Label>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
            {lastResponse}
          </pre>
        </div>
      )}
    </div>
  );
}
