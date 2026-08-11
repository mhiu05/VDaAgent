# When is data profiling conducted?

*Topic: Data Profiling (https://en.wikipedia.org/wiki/Data_profiling)*

According to Kimball, data profiling is performed several times and with varying intensity throughout the data warehouse developing process. A light profiling assessment should be undertaken immediately after candidate source systems have been identified and DW/BI business requirements have been satisfied. The purpose of this initial analysis is to clarify at an early stage if the correct data is available at the appropriate detail level and that anomalies can be handled subsequently. If this is not the case the project may be terminated.

Additionally, more in-depth profiling is done prior to the dimensional modeling process in order assess what is required to convert data into a dimensional model. Detailed profiling extends into the ETL system design process in order to determine the appropriate data to extract and which filters to apply to the data set.

Additionally, data profiling may be conducted in the data warehouse development process after data has been loaded into staging, the data marts, etc. Conducting data at these stages helps ensure that data cleaning and transformations have been done correctly and in compliance of requirements.