import { DocumentData, DocumentReference, DocumentSnapshot, FirestoreDataConverter, Timestamp } from 'firebase/firestore';

export interface PurchaseOrder {
    amount: number;
    createdAt: Timestamp;
    description: string;
    docId: number;
    id: string;
    otherCategory: string | null;
    projectDocId: number | null;
    serviceReportDocId: number | null;
    status: string;
    technicianRef: DocumentReference;
    vendor: string;
}

export interface PurchaseOrderHit {
    objectID: string;
    amount: number;
    createdAt: number;
    description: string;
    docId: number;
    id: string;
    otherCategory: string | null;
    projectDocId: number | null;
    serviceReportDocId: number | null;
    status: string;
    technicianRef: string;
    vendor: string;
}

export interface PurchaseOrderMessage {
    technician_name: string;
    technician_phone: string;
    technician_email: string;
    materials: string;
    purchase_order_num: number;
    project_info: string | null;
    service_report_info: string | null;
    other: string | null;
    vendor: string;
    amount: number;
    /** Legacy inline base64; prefer attachment_storage_paths to avoid request size limits. */
    attachments?: Attachment[];
    /** Firebase Storage paths under receipts/po-{purchase_order_num}/ */
    attachment_storage_paths?: string[];
    attachment_types?: string[];
}

export interface Attachment {
    content: string;
    type: string;
}

export const purchaseOrderConverter: FirestoreDataConverter<PurchaseOrder> = {
    toFirestore(purchaseOrder: PurchaseOrder): DocumentData {
        return {
            "amount": purchaseOrder.amount,
            "created-at": purchaseOrder.createdAt,
            "description": purchaseOrder.description,
            "doc-id": purchaseOrder.docId,
            "other-category": purchaseOrder.otherCategory,
            "project-doc-id": purchaseOrder.projectDocId,
            "service-report-doc-id": purchaseOrder.serviceReportDocId,
            "status": purchaseOrder.status,
            "technician-ref": purchaseOrder.technicianRef,
            "vendor": purchaseOrder.vendor,
        };
    },
    fromFirestore(snapshot: DocumentSnapshot): PurchaseOrder {
        const data = snapshot.data()!;
        return {
            id: snapshot.id,
            amount: data["amount"],
            createdAt: data["created-at"],
            description: data["description"],
            docId: data["doc-id"],
            otherCategory: data["other-category"],
            projectDocId: data["project-doc-id"],
            serviceReportDocId: data["service-report-doc-id"],
            status: data["status"],
            technicianRef: data["technician-ref"],
            vendor: data["vendor"],
        };
    }
};