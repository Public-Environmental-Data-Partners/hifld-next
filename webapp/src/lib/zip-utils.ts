import JSZip from "jszip";

export interface FileUrl {
  name: string;
  url: string;
}

/**
 * Create a zip file from multiple file URLs and trigger download
 * @param files Array of files with name and URL
 * @param zipFilename Name for the downloaded zip file
 * @param onProgress Optional progress callback (0-100)
 */
export async function createZipFromUrls(
  files: FileUrl[],
  zipFilename: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const zip = new JSZip();
  let loadedCount = 0;
  const totalFiles = files.length;

  // Fetch all files in parallel
  const fetchPromises = files.map(async (file) => {
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file.name}: ${response.statusText} (${response.status})`);
      }
      const blob = await response.blob();
      
      // Add to zip
      zip.file(file.name, blob);
      
      // Update progress
      loadedCount++;
      if (onProgress) {
        onProgress(Math.round((loadedCount / totalFiles) * 100));
      }
      
      return { name: file.name, success: true };
    } catch (error) {
      console.error(`Error fetching ${file.name}:`, error);
      return { name: file.name, success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  });

  // Wait for all files to be fetched and check results
  const results = await Promise.all(fetchPromises);
  const failedFiles = results.filter(r => !r.success);
  
  if (failedFiles.length > 0) {
    const errorMessages = failedFiles.map(f => 
      `${f.name}: ${f.error?.message || 'Unknown error'}`
    ).join('\n');
    
    const error = new Error(
      `Failed to download ${failedFiles.length} of ${totalFiles} files:\n${errorMessages}`
    );
    console.error('Zip creation failed:', error);
    throw error;
  }

  // Generate zip file
  if (onProgress) {
    onProgress(95); // Almost done, generating zip
  }

  const zipBlob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE" },
    (metadata) => {
      // Update progress during zip generation
      if (onProgress) {
        const progress = 95 + Math.round((metadata.percent / 100) * 5); // 95-100%
        onProgress(progress);
      }
    }
  );

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up
  URL.revokeObjectURL(url);
  
  if (onProgress) {
    onProgress(100);
  }
}

/**
 * Extract shapefile URLs from expanded sources
 * @param sources Array of source objects from the API
 * @returns Array of file URLs with names
 */
export function extractShapefileUrls(sources: Array<{
  id?: number;
  url?: string;
  location?: { path?: string; type?: string };
  glob_pattern?: string;
}>): FileUrl[] {
  const fileUrls: FileUrl[] = [];
  
  for (const source of sources) {
    if (!source.url || !source.location?.path) {
      continue;
    }
    
    // Extract filename from path
    const pathParts = source.location.path.split("/");
    const filename = pathParts[pathParts.length - 1];
    
    // Only include if it's a shapefile component
    // Shapefile components: .shp, .shx, .dbf, .prj, .cpg, .sbn, .sbx, etc.
    const shapefileExtensions = [
      ".shp", ".shx", ".dbf", ".prj", ".cpg", 
      ".sbn", ".sbx", ".fbn", ".fbx", ".ain", ".aih",
      ".atx", ".ixs", ".mxs", ".qix", ".shp.xml"
    ];
    
    const hasShapefileExtension = shapefileExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
    
    if (hasShapefileExtension) {
      fileUrls.push({
        name: filename,
        url: source.url,
      });
    }
  }
  
  return fileUrls;
}

