# DEPLOY — Auto Pārbaudītājs V4.0

## Render (recommended first deployment)

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root.
3. In Render choose **New → Blueprint**.
4. Connect the GitHub repository.
5. Render detects `render.yaml`.
6. Create/apply the Blueprint.
7. When deployment is healthy, open the generated `*.onrender.com` address.
8. Test `/api/health` first, then paste a real SS.COM / SS.LV car listing into Auto Pārbaudītājs.

Expected health response:

```json
{"ok":true,"service":"Auto Pārbaudītājs","version":"4.0.0"}
```

The frontend uses the same origin endpoint `/api/listing`, so no frontend API URL needs to be edited for this deployment.

## First live acceptance test

A successful real-listing test should:

- accept an SS.COM / SS.LV `/transport/cars/` listing URL;
- display “Savienojos ar auto datu serveri…”;
- auto-populate at least make/model/year/engine or gearbox/mileage/price;
- show the green success status;
- automatically render the existing analysis;
- keep manual fields available if a listing cannot be parsed.

## If SS changes its page layout

Update `ss-parser.js`. The frontend does not need to change unless the API response contract changes.
