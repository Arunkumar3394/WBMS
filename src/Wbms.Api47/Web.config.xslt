<?xml version="1.0" encoding="utf-8"?>
<!-- Turns the built App.config (with its binding redirects) into the Web.config of the IIS / Azure package.
     Used by the PublishSite target in Publish.targets. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes" encoding="utf-8" />
  <xsl:strip-space elements="*" />

  <xsl:template match="@*|node()">
    <xsl:copy><xsl:apply-templates select="@*|node()" /></xsl:copy>
  </xsl:template>

  <!-- The App.config comments describe local development; the live settings get their own below.
       IIS decides the runtime, and the address comes from the IIS site binding. -->
  <xsl:template match="comment()" />
  <xsl:template match="startup" />
  <xsl:template match="appSettings/add[@key='Web:Url']" />

  <xsl:template match="connectionStrings">
    <xsl:comment> SQL Server on the web server. With Trusted_Connection, give the IIS app pool (IIS APPPOOL\wbms) a login in SQL Server, or use User Id=...;Password=... instead. The database is created on the first start. </xsl:comment>
    <connectionStrings>
      <add name="Wbms" connectionString="Server=.\SQLEXPRESS;Database=Wbms;Trusted_Connection=True;MultipleActiveResultSets=true" providerName="System.Data.SqlClient" />
    </connectionStrings>
  </xsl:template>

  <xsl:template match="appSettings">
    <xsl:comment> See deploy\DEPLOY.md. Jwt:Key must be your own random text of 32+ characters. Sms:Provider must be Msg91 for customers to receive sign-in codes. </xsl:comment>
    <xsl:copy><xsl:apply-templates select="@*|node()" /></xsl:copy>
  </xsl:template>

  <!-- A live site never ships the development signing key or the demo accounts. -->
  <xsl:template match="appSettings/add[@key='Jwt:Key']/@value"><xsl:attribute name="value" /></xsl:template>
  <xsl:template match="appSettings/add[@key='Seed:DemoData']/@value"><xsl:attribute name="value">false</xsl:attribute></xsl:template>

  <xsl:template match="appSettings/add[@key='Seed:DemoData']">
    <xsl:copy><xsl:apply-templates select="@*" /></xsl:copy>
    <xsl:comment> First admin, created on the first start when no admin exists. Remove both values after signing in. </xsl:comment>
    <add key="Setup:AdminPhone" value="" />
    <add key="Setup:AdminPassword" value="" />
  </xsl:template>

  <xsl:template match="configuration">
    <xsl:copy>
      <xsl:apply-templates select="@*|configSections" />
      <system.web>
        <compilation debug="false" targetFramework="4.7" />
        <httpRuntime targetFramework="4.7" maxRequestLength="10240" enableVersionHeader="false" />
        <customErrors mode="RemoteOnly" />
        <hostingEnvironment shadowCopyBinAssemblies="false" />
      </system.web>
      <system.webServer>
        <!-- Every request (API and Angular pages) goes through the OWIN pipeline in IisStartup. -->
        <modules runAllManagedModulesForAllRequests="true" />
        <httpProtocol>
          <customHeaders>
            <remove name="X-Powered-By" />
          </customHeaders>
        </httpProtocol>
      </system.webServer>
      <xsl:apply-templates select="node()[not(self::configSections)]" />
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
