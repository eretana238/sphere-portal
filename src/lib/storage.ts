import { getStorage, ref, listAll, getDownloadURL } from "firebase/storage";

// List all files in a receipts folder and return their metadata
export async function listReceiptFiles(folder: string) {
  const storage = getStorage();
  const folderRef = ref(storage, `receipts/${folder}`);
  const res = await listAll(folderRef);
  // Get file name and type for each item
  return await Promise.all(
    res.items.map(async (itemRef) => {
      const url = await getDownloadURL(itemRef);
      const name = itemRef.name;
      // Infer file type from name extension
      const type = name.split(".").pop() || "unknown";
      return { name, type, url, storagePath: itemRef.fullPath };
    })
  );
}
