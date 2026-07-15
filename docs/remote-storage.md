# Profile storage

The editor supports local folders and remote named profiles. The mode is
selected in `.env.local`:

```dotenv
VITE_PROJECT_STORAGE_MODE=remote
VITE_FRAMEDATA_CDN_BASE_URL=https://www.sports.ru/special/json-admin-backend/fighting-editor
VITE_FRAMEDATA_SAVE_URL=https://www.sports.ru/special/json-admin-backend/shared/add-item
VITE_FRAMEDATA_PROFILE_SLUG=fighting-editor
VITE_FRAMEDATA_REQUEST_CREDENTIALS=include
```

Restart Vite after changing environment variables. All configuration is read
in `src/config/projectStorage.ts`. Do not put private tokens in `VITE_*`
variables because Vite embeds them into the browser bundle.

## Stored JSON format

The read endpoint returns one object. Every top-level key is a profile name and
its value contains the same framedata that was previously stored as separate
files:

```json
{
  "Vladimir": {
    "framedata": {
      "IDLE": {
        "duration": 40,
        "hurtboxes": [],
        "hitboxes": [],
        "blendFramesNumber": 4,
        "loop": true
      }
    },
    "animations": {
      "IDLE": {
        "left": "A_StanceA_Idle_IP",
        "right": "A_StanceB_Idle_IP"
      }
    }
  }
}
```

The editor also accepts a profile value containing this object as a serialized
JSON string, but all new writes send it as an object.

## Saving

Creating a profile and saving states both send a `POST` request to
`VITE_FRAMEDATA_SAVE_URL`:

```json
{
  "value": {
    "framedata": {},
    "animations": {}
  },
  "key": "Vladimir",
  "slug": "fighting-editor"
}
```

When only selected states are saved, the editor first downloads the newest
profile, merges those states into it, and then writes the complete profile.
This prevents unrelated states in the same profile from being overwritten by
a partial save.

## Profile drafts

Unsaved edits remain in browser `localStorage`. Each profile has a separate
draft key, so changes from one profile cannot be restored into another one.

## Character assets

The character and Draco decoder paths are independent from profile storage:

```dotenv
VITE_CHARACTER_MODEL_URL=/models/character_test.glb
VITE_DRACO_DECODER_PATH=/draco/
```
