import { collection, DocumentData, getDocs, query, where } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { Employee } from "@/models/Employee";
import { ProjectReportMessage } from "@/models/ProjectReport";
import { Project } from "@/models/Project";
import { ServiceReportMessage } from "@/models/ServiceReport";

/**
 * Builds `Authorization: Bearer <base64(clientId:clientSecret)>` for Applied BAS APIs.
 * Trims credentials and rejects missing values so the header is never `Bearer` without a token
 * (which omits the required space after `Bearer` and triggers "Authorization must start with 'Bearer '").
 */
export function buildAppliedBasAuthorizationHeader(employee: Employee): string {
  const id = String(employee.clientId ?? "")
    .trim()
    .replace(/\r|\n/g, "");
  const secret = String(employee.clientSecret ?? "")
    .trim()
    .replace(/\r|\n/g, "");
  if (!id || !secret) {
    throw new Error(
      "Missing client API credentials (client-id / client-secret) on your employee record."
    );
  }
  const token = btoa(`${id}:${secret}`);
  if (!token) {
    throw new Error("Invalid API credentials encoding.");
  }
  return `Bearer ${token}`;
}

/**
 * Fetches employee data by email.
 */
export async function getEmployeeByEmail(email: string): Promise<Employee> {
  const usersRef = collection(firestore, "employees");
  const q = query(usersRef, where("email", "==", email));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    throw new Error("Employee record not found");
  }

  const data = snapshot.docs[0].data();
  return {
    id: snapshot.docs[0].id,
    clientId: data["client-id"],
    clientSecret: data["client-secret"],
    createdAt: data["created-at"],
    updatedAt: data["updated-at"],
    ...data,
  } as Employee;
}

export async function getProjectById(docId: number): Promise<Project> {
  const projectsRef = collection(firestore, "projects");
  const q = query(projectsRef, where("doc-id", "==", docId))
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    throw new Error("Project not found");
  }

  const data: DocumentData = snapshot.docs[0].data();
  return {
    id: snapshot.docs[0].id,
    docId: data["doc-id"],
    createdAt: data["created-at"],
    updatedAt: data["updated-at"],
    parentRef: data["parent-ref"],
    ...data,
  } as Project;
}

export async function sendProjectReportEmail(message: ProjectReportMessage, employee: Employee): Promise<Response>{
  const authorization = buildAppliedBasAuthorizationHeader(employee);

  return await fetch("https://api.appliedbas.com/v2/mail/pr", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}

export async function sendServiceReportEmail(
  message: ServiceReportMessage,
  employee: Employee
): Promise<Response> {
  const authorization = buildAppliedBasAuthorizationHeader(employee);

  return await fetch("https://api.appliedbas.com/v2/mail/sr", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}
