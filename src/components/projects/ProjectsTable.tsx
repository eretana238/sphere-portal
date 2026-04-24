"use client";

import Link from "next/link";
import { projectConverter, ProjectHit } from "@/models/Project";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { toast } from "sonner";

interface ProjectsTableProps {
  projects: ProjectHit[];
  setProjects: (projects: ProjectHit[]) => void;
}

export function ProjectsTable({ projects, setProjects }: ProjectsTableProps) {
  const [updatingProjects, setUpdatingProjects] = useState<Set<string>>(new Set());

  const handleToggleActive = async (project: ProjectHit) => {
    const projectId = project.objectID;
    setUpdatingProjects(prev => new Set(prev).add(projectId));
    
    

    try {
      const projectRef = doc(firestore, "projects", projectId).withConverter(projectConverter);
      const projectSnap = await getDoc(projectRef);

      if (projectSnap.exists()) {
        const currentActive = projectSnap.data().active;
        await updateDoc(projectRef, { active: !currentActive });
        // Update local state
        setProjects(
          projects.map((p: ProjectHit) =>
            p.objectID === projectId ? { ...p, active: !currentActive } : p
          )
        );
        toast.success(`Project ${project.docId} is now ${!currentActive ? "Active" : "Inactive"}.`);
      }
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Failed to update project status.");
    } finally {
      setUpdatingProjects(prev => {
        const updated = new Set(prev);
        updated.delete(project.objectID);
        return updated;
      });
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Doc ID</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Balance</TableHead>
          <TableHead>Created At</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.objectID}>
            <TableCell>{project.docId}</TableCell>
            <TableCell>{project.client}</TableCell>
            <TableCell className="max-w-xs truncate">{project.location}</TableCell>
            <TableCell className="max-w-xs truncate">{project.description}</TableCell>
            <TableCell>${project.balance?.toLocaleString() || "0"}</TableCell>
            <TableCell>{new Date(project.createdAt).toLocaleString()}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={
                  project.active
                    ? "text-green-800 border-green-300 bg-green-50"
                    : "text-red-800 border-red-300 bg-red-50"
                }
              >
                {project.active ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild disabled>
                    <Link href={`/dashboard/projects/${project.objectID}`}>
                      View
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild disabled>
                    <Link href={`/dashboard/projects/${project.objectID}/edit`}>
                      Edit
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleToggleActive(project)}
                    disabled={updatingProjects.has(project.objectID)}
                  >
                    {project.active ? "Set Inactive" : "Set Active"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}