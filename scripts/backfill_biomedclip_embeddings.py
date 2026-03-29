import os
import sys
from pathlib import Path
import numpy as np

# Add src to sys.path
sys.path.append(str(Path(__file__).parent.parent / "src"))

from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.config import SITE_ROOT_DIR

def backfill():
    cp = ControlPlaneStore()
    workflow = ResearchWorkflowService(cp)
    
    # Discovery: Look at both CP sites and actual directories in SITE_ROOT_DIR
    site_ids = set()
    try:
        for site in cp.list_sites():
            sid = site.get("site_id")
            if sid: site_ids.add(str(sid))
    except Exception:
        pass
        
    if SITE_ROOT_DIR.exists():
        for item in SITE_ROOT_DIR.iterdir():
            if item.is_dir():
                site_ids.add(item.name)

    print(f"Discovery found {len(site_ids)} potential sites: {site_ids}")
    
    for site_id in site_ids:
        print(f"\n>>> Checking site: {site_id}")
        try:
            site_store = SiteStore(site_id)
            all_images = site_store.list_images()
            image_paths = [str(img.get("image_path")) for img in all_images if img.get("image_path")]
            
            if not image_paths:
                print(f"No images found for site {site_id}")
                continue
                
            print(f"Found {len(image_paths)} images. Encoding...")
            persistence_dir = site_store.embedding_dir / "biomedclip"
            
            # Use GPU if available
            device = os.getenv("KERA_BIOMEDCLIP_DEVICE") or "auto"
            
            # We use a batch size of 32 for efficiency
            workflow.text_retriever.encode_images(
                image_paths, 
                requested_device=device, 
                batch_size=32,
                persistence_dir=persistence_dir
            )
            print(f"Finished backfilling for site {site_id}")
        except Exception as e:
            print(f"Error processing site {site_id}: {e}")

if __name__ == "__main__":
    backfill()
