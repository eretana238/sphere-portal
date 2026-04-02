"use client";

import React, { useState } from "react";
import { getStorage, ref, uploadBytes } from "firebase/storage";
import { PurchaseOrderMessage } from "@/models/PurchaseOrder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function MailSelfTestPage() {
  const { user } = useAuth();
  const [poNum, setPoNum] = useState<string>("");
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [sending, setSending] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  const receiptUploading = receiptItems.some((i) => i.uploading);

  const uploadReceiptForItem = async (itemId: string, file: File, docId: number) => {
    const storage = getStorage();
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
      toast.error("Enter a valid PO number first (matches receipts/po-{number}/ in Storage).");
      return;
    }
    const filtered = Array.from(files).filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`Not allowed: ${file.name} (${file.type || "unknown type"})`);
        return false;
      }
      return true;
    });
    setReceiptItems((prev) => {
      const uniqueNew = filtered.filter(
        (file) =>
          !prev.some((p) => p.file.name === file.name && p.file.size === file.size)
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

  const sendTest = async () => {
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
    if (paths.length === 0 || receiptUploading || receiptItems.some((i) => i.error)) {
      toast.error("Add files and wait until all uploads finish.");
      return;
    }

    setSending(true);
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
      let parsed: { message?: string; sent_to?: string; attachment_count?: number } =
        {};
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
      setSending(false);
    }
  };

  const readyToSend =
    receiptItems.length > 0 &&
    receiptItems.every((i) => i.storagePath && !i.uploading && !i.error) &&
    !Number.isNaN(parseInt(poNum, 10)) &&
    parseInt(poNum, 10) > 0;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          PO mail self-test
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Sends a <strong>test</strong> purchase-order email <strong>only to your</strong>{" "}
          employee email (via <code className="text-xs">/api/mail/po/test</code>). Billing
          and Bcc are not used. Use a real PO number you own so receipt paths match{" "}
          <code className="text-xs">receipts/po-&#123;number&#125;/…</code> in Firebase
          Storage.
        </p>
      </div>

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
                  <span className="text-xs text-muted-foreground">ready</span>
                )}
                {item.error && (
                  <span className="text-xs text-destructive">{item.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        onClick={sendTest}
        disabled={!readyToSend || sending || !user?.email}
      >
        {sending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          "Send test to my email"
        )}
      </Button>

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
