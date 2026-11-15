// Charlie Maps: an object graph, no SQL store.
// Run once per instance, Cypher 5 compatible; repeatable IF NOT EXISTS.
CREATE CONSTRAINT cm_feed_key IF NOT EXISTS FOR (n:FeedBatch) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_line_id IF NOT EXISTS FOR (n:Line) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_route_id IF NOT EXISTS FOR (n:Route) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_pattern_id IF NOT EXISTS FOR (n:RoutePattern) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_stop_id IF NOT EXISTS FOR (n:Stop) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_shape_id IF NOT EXISTS FOR (n:Shape) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_service_id IF NOT EXISTS FOR (n:ServiceCalendar) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_trip_id IF NOT EXISTS FOR (n:Trip) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_call_key IF NOT EXISTS FOR (n:StopTime) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_transfer_key IF NOT EXISTS FOR (n:Transfer) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_pathway_key IF NOT EXISTS FOR (n:Pathway) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_vehicle_id IF NOT EXISTS FOR (n:Vehicle) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT cm_run_key IF NOT EXISTS FOR (n:ServiceRun) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_prediction_key IF NOT EXISTS FOR (n:Prediction) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_observation_key IF NOT EXISTS FOR (n:VehicleObservation) REQUIRE n.key IS UNIQUE;
CREATE CONSTRAINT cm_alert_id IF NOT EXISTS FOR (n:Alert) REQUIRE n.id IS UNIQUE;
CREATE INDEX cm_stop_name IF NOT EXISTS FOR (n:Stop) ON (n.name);
CREATE INDEX cm_stop_geo IF NOT EXISTS FOR (n:Stop) ON (n.location);
CREATE INDEX cm_call_departure IF NOT EXISTS FOR (n:StopTime) ON (n.departureSeconds);
CREATE INDEX cm_run_date IF NOT EXISTS FOR (n:ServiceRun) ON (n.serviceDate);
CREATE INDEX cm_obs_time IF NOT EXISTS FOR (n:VehicleObservation) ON (n.observedAt);
CREATE INDEX cm_batch_status IF NOT EXISTS FOR (n:FeedBatch) ON (n.status);

// Planned relationships documented below; ingestion must MERGE, not duplicate:
// (:FeedBatch)-[:CONTAINS]->(static objects)
// (:Line)-[:HAS_ROUTE]->(:Route)-[:HAS_PATTERN]->(:RoutePattern)
// (:Route)-[:RUNS_TRIP]->(:Trip)-[:USES_SERVICE]->(:ServiceCalendar)
// (:Trip)-[:HAS_CALL]->(:StopTime)-[:AT_STOP]->(:Stop)
// (:StopTime)-[:NEXT_CALL]->(:StopTime)
// (:Trip)-[:FOLLOWS_SHAPE]->(:Shape)
// (:Stop)-[:PART_OF_STATION]->(:Stop:Station)
// (:Stop)-[:CONNECTED_BY]->(:Transfer), (:Pathway)
// (:ServiceRun)-[:INSTANCE_OF]->(:Trip)
// (:Vehicle)-[:ASSIGNED_TO]->(:ServiceRun)
// (:Prediction)-[:UPDATES]->(:StopTime), (:Prediction)-[:FOR_RUN]->(:ServiceRun)
// (:VehicleObservation)-[:OF_VEHICLE]->(:Vehicle)
// (:Alert)-[:AFFECTS]->(:Route|Stop|ServiceRun)
//
// StopTime is one object per GTFS trip/stop_sequence (not a shared numeric time).
// ServiceRun is one dated instance of a Trip. Static and realtime never overwrite each other.
// GTFS times can exceed 24:00; store seconds from LOCAL SERVICE DAY, not modulo 24 hours.
// Use America/New_York and explicitly handle DST and service boundaries.
