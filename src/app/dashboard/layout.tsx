import React from "react";
import type { Metadata } from "next";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

export const metadata: Metadata = {
  title: "Dashboard | Sphere Portal",
  description: "Access your dashboard, reports, and settings in the Sphere Portal",
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
      <SidebarProvider>
        <AppSidebar />
        <main className="flex-1 h-screen w-full">
          <SidebarTrigger className="p-4 m-2"/>
          <div className="px-4 md:px-8 py-4">
            {children}
          </div>
        </main>
      </SidebarProvider>
  );
};

export default Layout;
