import os
import re

def refine_curves(directory):
    # Regex to match rounded classes that need to be changed to rounded-md
    # We target: rounded-lg, rounded-xl, rounded-2xl, rounded-3xl, rounded-[...] where ... > 8px (md is 6px, lg is 8px)
    # Actually, the user says "minimalist curves (md)", so anything larger than md should be md.
    # Note: rounded-full should probably stay rounded-full for avatars/status dots.
    
    # regex for rounded-(lg|xl|2xl|3xl) and rounded-\[[^\]]*\]
    # We also need to be careful with things like rounded-b-xl etc.
    
    pattern = re.compile(r'rounded-(lg|xl|2xl|3xl|\[2[0-9]px\]|\[3[0-9]px\]|\[1[2-9]px\])')
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.tsx', '.ts', '.css', '.js')):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                new_content = pattern.sub('rounded-md', content)
                
                # Special cases for explicit rounded-t-xl etc.
                new_content = re.sub(r'rounded-([trbl]|tl|tr|bl|br)-(lg|xl|2xl|3xl)', r'rounded-\1-md', new_content)
                
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated curves in {path}")

if __name__ == "__main__":
    refine_curves(r'c:\Users\valer\OneDrive\Escritorio\Workspace\OzyBase\frontend\src')
